import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Accelerometer } from "expo-sensors";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useClock, useImage, type DataSourceParam, type SkImage } from "@shopify/react-native-skia";
import { normalize, type OrbPoint } from "./orbTouch";
import { assign, EMPTY_SLOTS, type RippleSlots } from "./orbRipples";
import { leanVector, nextState, settleTo, isFrozen, isTransient, targetsFor, transitionMs, type OrbState } from "./orbState";
import { HOLD_FULL_MS, offsetsFor, releaseHaptic, releaseStrength } from "./orbGesture";
import { GREET_DELAY_MS, GREET_STRENGTH, STIR_HALO, STIR_RISE_MS, nextStirDelay, stirVector, stirs } from "./orbIdle";
import { TILT_REF_BETA, TILT_SMOOTH, smooth, tiltOffset, trackReference } from "./orbTilt";
import { resolve, rippleCapacity, type OrbQualityProp } from "./orbQuality";
import { orbCompiled } from "./orbShader";
import { OracleOrbCanvas, type OrbUniforms } from "./OracleOrbCanvas";

const FALLBACK = require("../../../assets/art/orb-fallback.png");
const SHELL = require("../../../assets/art/orb-shell.png");
const INTERIOR = require("../../../assets/art/orb-interior.png");

// How long the bloom takes to close again once the finger lifts. Faster than
// it opened: letting go is a release, not a second slow gesture.
const RELEASE_MS = 380;

// How often the accelerometer is read. 30Hz is plenty for a field this
// low-frequency, and is the difference between a sensor you can feel in the
// battery and one you cannot.
const TILT_INTERVAL_MS = 33;

// How long a tilt takes to let go when the app leaves the foreground. The
// sensor stops, so without this the interior would freeze mid-slide.
const TILT_RELEASE_MS = 400;

// The warm centre chases the fingertip on a spring, and never catches it.
// That lag is the wake -- the interior has weight, so the light arrives where
// your finger was a moment ago.
const WAKE_SPRING = { damping: 14, stiffness: 90, mass: 0.9 } as const;

// `useImage`'s own state (@shopify/react-native-skia's `useLoading`) is a
// fresh `useState(null)` per mount, so a mount can never see a cache hit
// synchronously *through the hook itself* -- there is no way to seed a
// library-owned useState from outside it. This module-scope map is the
// closest substitute: once any instance finishes decoding a source, every
// later mount reads the resolved image straight off this map on its first
// render, instead of re-fetching and re-decoding the same PNG. The boot rite
// mounts the first instance; by the time it hands off to Home's, the decode
// is long done, so that second mount is genuinely synchronous.
const imageCache = new Map<DataSourceParam, SkImage>();

function useCachedImage(source: DataSourceParam, onError: (e: Error) => void): SkImage | null {
  const cached = imageCache.get(source) ?? null;
  // Once cached, there is nothing left to load -- pass `null` so the
  // underlying hook's loader resolves immediately instead of re-decoding.
  const loaded = useImage(cached ? null : source, onError);
  useEffect(() => {
    if (loaded && !imageCache.has(source)) imageCache.set(source, loaded);
  }, [loaded, source]);
  return cached ?? loaded;
}

export type OracleOrbHandle = {
  ripple(local?: OrbPoint): void;
  transitionTo(state: OrbState): void;
  settle(): void;
};

export const OracleOrb = forwardRef<OracleOrbHandle, {
  tile: number;
  state?: OrbState;
  quality?: OrbQualityProp;
  interactive?: boolean;
  // The day's first arrival: the orb ripples once, by itself, a beat after it
  // settles. Nothing on this screen says the glass is touchable, so the orb
  // says it in the only language it has.
  greet?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  onPress?(local: OrbPoint): void;
}>(function OracleOrb(
  { tile, state = "attending", quality = "auto", interactive = false, greet = false, accessibilityLabel = "Oracle", testID, onPress },
  ref,
) {
  const reducedMotion = useReducedMotion();

  // The canvas's own images -- these gate the live tiers. A failure here is
  // a shader with nothing to sample, so it must fall to static. This is a
  // distinct signal from the *fallback* image failing (below): static is
  // already the floor, so that failure has nowhere lower to report to.
  const [canvasImagesFailed, setCanvasImagesFailed] = useState(false);
  const onImageError = useCallback(() => setCanvasImagesFailed(true), []);
  const shell = useCachedImage(SHELL, onImageError);
  const interior = useCachedImage(INTERIOR, onImageError);
  const tier = resolve({ prop: quality, reducedMotion, compiled: orbCompiled(), imagesReady: !canvasImagesFailed });

  const [current, setCurrent] = useState<OrbState>(state);
  const previousState = useRef<OrbState>(current);
  const slots = useRef<RippleSlots>(EMPTY_SLOTS);
  const clock = useClock();
  const paused = useSharedValue(AppState.currentState === "active" ? 0 : 1);

  // The animated targets. Each is its own shared value so Reanimated can
  // blend an interrupted transition rather than snapping it.
  const parallax = useSharedValue(targetsFor(state).parallax);
  const centerDepth = useSharedValue(targetsFor(state).centerDepth);
  const centerLean = useSharedValue(targetsFor(state).centerLean);
  const refraction = useSharedValue(targetsFor(state).refraction);
  const halo = useSharedValue(targetsFor(state).halo);
  const timeScale = useSharedValue(targetsFor(state).timeScale);
  const rippleA = useSharedValue<readonly [number, number, number, number]>([0, 0, 0, 0]);
  const rippleB = useSharedValue<readonly [number, number, number, number]>([0, 0, 0, 0]);

  // Touch. `touch` is the fingertip exactly -- the lens under it must not lag,
  // or the glass reads as sticky. `lead` is the same point on a spring, and
  // is what the warm centre follows. `bloom` is how far the hold has opened,
  // and multiplies every one of the gesture's offsets, so at rest the whole
  // interaction layer contributes exactly nothing.
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const leadX = useSharedValue(0);
  const leadY = useSharedValue(0);
  const bloom = useSharedValue(0);
  const onGlass = useSharedValue(0);

  // The tilt: the interior answering the phone being moved. Smoothed on the
  // JS thread as samples arrive, then read as one more addend on the lean.
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  // The frame the tilt is measured against. A plain ref, not a shared value:
  // only the sensor callback ever touches it, and it never drives a frame.
  const tiltRef = useRef<{ x: number; z: number } | null>(null);

  // The stir: the orb's own small unprompted motion, added on top of whatever
  // the state is already doing.
  const stirX = useSharedValue(0);
  const stirY = useSharedValue(0);
  const stirHalo = useSharedValue(0);
  const touching = useRef(false);

  // The orb's own accumulated time. It is integrated from the clock rather
  // than read off it, for two reasons: timeScale becomes a *rate*, so slowing
  // the orb down never jumps its phase; and pausing genuinely holds the
  // current frame instead of snapping the interior back to t = 0.
  const elapsed = useSharedValue(0);
  const lastTick = useSharedValue(-1);

  // Follow the state prop through the state machine, so a repeated prop never
  // restarts a transient and dormant never claims a woken orb.
  useEffect(() => {
    setCurrent((c) => nextState(c, state));
  }, [state]);

  // Drive the uniforms toward the current state's targets.
  useEffect(() => {
    const from = previousState.current;
    const to = targetsFor(current);
    const ms = transitionMs(from, current);
    const cfg = { duration: ms, easing: Easing.inOut(Easing.quad) };
    parallax.value = withTiming(to.parallax, cfg);
    centerDepth.value = withTiming(to.centerDepth, cfg);
    centerLean.value = withTiming(to.centerLean, cfg);
    refraction.value = withTiming(to.refraction, cfg);
    halo.value = withTiming(to.halo, cfg);
    timeScale.value = withTiming(to.timeScale, cfg);
    previousState.current = current;

    // A transient resolves into its steady state on its own.
    if (!isTransient(current)) return;
    const id = setTimeout(() => setCurrent((c) => (c === current ? settleTo(current) : c)), ms);
    return () => clearTimeout(id);
  }, [current, parallax, centerDepth, centerLean, refraction, halo, timeScale]);

  // Stop the clock when the app is not in front. No work while backgrounded.
  // `foreground` mirrors this in React state as well, because the sensor
  // subscription below is a real cost that has to be torn down, not just a
  // uniform that can be frozen.
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      paused.value = s === "active" ? 0 : 1;
      setForeground(s === "active");
    });
    return () => sub.remove();
  }, [paused]);

  const live = useDerivedValue<OrbUniforms>(() => {
    // Integrate, don't sample: dt is scaled, so timeScale is a rate and the
    // phase is continuous across every change of state and every pause.
    const now = clock.value / 1000;
    const dt = lastTick.value < 0 ? 0 : Math.max(0, Math.min(0.1, now - lastTick.value));
    lastTick.value = now;
    if (!paused.value) elapsed.value += dt * timeScale.value;
    // The gesture reads the *sprung* point, not the fingertip: the lean is
    // what has weight. The lens below reads the fingertip itself.
    const off = offsetsFor({ x: leadX.value, y: leadY.value }, bloom.value);
    return {
      t: elapsed.value,
      now,
      parallax: parallax.value,
      centerDepth: centerDepth.value + off.depth,
      centerLean: leanVector(
        centerLean.value,
        off.leanX + stirX.value + tiltX.value,
        off.leanY + stirY.value + tiltY.value,
      ),
      refraction: refraction.value,
      halo: halo.value + off.halo + stirHalo.value,
      rippleA: rippleA.value,
      rippleB: rippleB.value,
      contact: [touchX.value, touchY.value, off.contact],
    };
  }, []);

  const fire = useCallback(
    (local: OrbPoint, strength: number, haptic: "light" | "medium" | null) => {
      const capacity = rippleCapacity(tier);
      if (capacity === 0) return;
      const nowMs = Date.now();
      const nowSec = clock.value / 1000;
      slots.current = assign(slots.current, { origin: local, startMs: nowMs, strength }, nowMs, capacity);
      const pack = (i: 0 | 1): readonly [number, number, number, number] => {
        const r = slots.current[i];
        if (!r) return [0, 0, 0, 0];
        // The shader's clock is in the same seconds the uniforms carry, so a
        // ripple's start is expressed there, not in wall time.
        return [r.origin.x, r.origin.y, r.startMs === nowMs ? nowSec : nowSec - (nowMs - r.startMs) / 1000, r.strength];
      };
      rippleA.value = pack(0);
      rippleB.value = pack(1);
      // The greeting passes null: the orb moving on its own must never be
      // mistaken for the phone registering a touch the player did not make.
      if (haptic === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (haptic === "medium") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    [tier, clock, rippleA, rippleB],
  );

  useImperativeHandle(
    ref,
    () => ({
      ripple: (local) => fire(local ?? { x: 0, y: 0 }, 1, "light"),
      transitionTo: (s) => setCurrent((c) => nextState(c, s)),
      settle: () => setCurrent((c) => settleTo(c)),
    }),
    [fire],
  );

  // A hold that reaches full bloom says so, once, in the quietest haptic
  // there is. Nothing marks the moment visually -- the interior just stops
  // opening -- so this is the only way to feel that you have all of it.
  const bloomTick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginTouch = useCallback(() => {
    touching.current = true;
    // The static tier has no bloom to complete, and `fire` already withholds
    // the release haptic there. A tick with nothing behind it would be the
    // one piece of feedback that outlived the thing it was describing.
    if (tier === "static") return;
    if (bloomTick.current) clearTimeout(bloomTick.current);
    bloomTick.current = setTimeout(() => void Haptics.selectionAsync(), HOLD_FULL_MS);
  }, [tier]);

  const endTouch = useCallback(
    (x: number, y: number, strength: number, haptic: "light" | "medium") => {
      touching.current = false;
      if (bloomTick.current) clearTimeout(bloomTick.current);
      bloomTick.current = null;
      // A drag can leave the glass. The ripple still belongs to the sphere,
      // so it starts at the rim under where the finger went.
      const len = Math.hypot(x, y);
      const at = len > 1 ? { x: x / len, y: y / len } : { x, y };
      fire(at, strength, haptic);
      onPress?.(at);
    },
    [fire, onPress],
  );

  useEffect(() => () => { if (bloomTick.current) clearTimeout(bloomTick.current); }, []);

  const pan = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .onBegin((e) => {
      const p = normalize({ x: e.x, y: e.y }, tile);
      // A press on the tile's corner is not a press on the glass.
      if (p.x * p.x + p.y * p.y > 1) {
        onGlass.value = 0;
        return;
      }
      onGlass.value = 1;
      touchX.value = p.x;
      touchY.value = p.y;
      // Placed, not sprung: the centre starts leaning from where you landed.
      leadX.value = p.x;
      leadY.value = p.y;
      bloom.value = withTiming(1, { duration: HOLD_FULL_MS, easing: Easing.out(Easing.quad) });
      runOnJS(beginTouch)();
    })
    .onUpdate((e) => {
      if (!onGlass.value) return;
      const p = normalize({ x: e.x, y: e.y }, tile);
      touchX.value = p.x;
      touchY.value = p.y;
      leadX.value = withSpring(p.x, WAKE_SPRING);
      leadY.value = withSpring(p.y, WAKE_SPRING);
    })
    .onFinalize(() => {
      if (!onGlass.value) return;
      onGlass.value = 0;
      // Read the bloom before releasing it: how far the hold opened is what
      // the ripple and the haptic are both weighed against.
      const b = bloom.value;
      runOnJS(endTouch)(touchX.value, touchY.value, releaseStrength(b), releaseHaptic(b));
      bloom.value = withTiming(0, { duration: RELEASE_MS, easing: Easing.out(Easing.quad) });
    });

  // The stir. A steady state only -- dormant is the rite's frozen still, and
  // a transient already owns the interior for its own duration.
  const stirring = interactive && tier !== "static" && stirs(current);
  useEffect(() => {
    if (!stirring) return;
    const rise = { duration: STIR_RISE_MS, easing: Easing.inOut(Easing.sin) };
    let running = true;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        if (!running) return;
        // Never under a finger -- the orb is already answering one -- and
        // never while the app is away, where the frames go to nobody.
        if (!touching.current && !paused.value) {
          const [x, y] = stirVector(Math.random());
          stirX.value = withSequence(withTiming(x, rise), withTiming(0, rise));
          stirY.value = withSequence(withTiming(y, rise), withTiming(0, rise));
          stirHalo.value = withSequence(withTiming(STIR_HALO, rise), withTiming(0, rise));
        }
        schedule();
      }, nextStirDelay(Math.random()));
    };
    schedule();
    return () => {
      running = false;
      clearTimeout(id);
      stirX.value = withTiming(0, rise);
      stirY.value = withTiming(0, rise);
      stirHalo.value = withTiming(0, rise);
    };
  }, [stirring, paused, stirX, stirY, stirHalo]);

  // The tilt. Subscribed only while the orb is live and the app is in front:
  // an accelerometer left running behind a locked screen is a battery cost
  // paid for frames nobody sees.
  // Not while dormant: Home mounts its orb in that state during the boot
  // rite's slide, and an accelerometer moving the interior would break the
  // very thing dormant exists to guarantee -- that what is held IS the
  // reference image.
  const tilting = interactive && tier !== "static" && foreground && !isFrozen(current);
  useEffect(() => {
    if (!tilting) return;
    let cancelled = false;
    let sub: { remove(): void } | null = null;
    void Accelerometer.isAvailableAsync().then((ok) => {
      // A device with no accelerometer keeps every other behaviour; the orb
      // simply never hears about the phone moving.
      if (!ok || cancelled) return;
      Accelerometer.setUpdateInterval(TILT_INTERVAL_MS);
      sub = Accelerometer.addListener(({ x, z }) => {
        // The very first sample only establishes the frame. Measuring it
        // against a zero reference would throw the interior hard to one side
        // the instant the sensor wakes.
        if (!tiltRef.current) {
          tiltRef.current = { x, z };
          return;
        }
        const [ox, oy] = tiltOffset(x - tiltRef.current.x, z - tiltRef.current.z);
        tiltX.value = smooth(tiltX.value, ox, TILT_SMOOTH);
        tiltY.value = smooth(tiltY.value, oy, TILT_SMOOTH);
        // The frame creeps toward however the phone is actually being held,
        // so a tilt that is simply held fades back to the canonical orb
        // instead of parking the brand object off its own axis.
        tiltRef.current = {
          x: trackReference(tiltRef.current.x, x, TILT_REF_BETA),
          z: trackReference(tiltRef.current.z, z, TILT_REF_BETA),
        };
      });
    });
    return () => {
      cancelled = true;
      sub?.remove();
      tiltRef.current = null;
      const cfg = { duration: TILT_RELEASE_MS, easing: Easing.out(Easing.quad) };
      tiltX.value = withTiming(0, cfg);
      tiltY.value = withTiming(0, cfg);
    };
  }, [tilting, tiltX, tiltY]);

  // The greeting, once, on the first steady state the orb reaches.
  const greeted = useRef(false);
  useEffect(() => {
    if (!greet || greeted.current || !interactive || tier === "static" || !stirs(current)) return;
    greeted.current = true;
    const id = setTimeout(() => fire({ x: 0, y: 0 }, GREET_STRENGTH, null), GREET_DELAY_MS);
    return () => clearTimeout(id);
  }, [greet, interactive, tier, current, fire]);

  // A live tier still renders the fallback until both rasters are actually
  // in hand -- while they're loading, and forever if a load rejects (which
  // never reaches canvasImagesFailed; see useCachedImage/onError above). A
  // live tier with nothing to sample must never be the frame that draws.
  const ready = !!shell && !!interior;
  const body =
    tier === "static" || !ready ? (
      <Image source={FALLBACK} contentFit="contain" style={{ width: tile, height: tile }} accessible={false} />
    ) : (
      <OracleOrbCanvas tile={tile} live={live} tier={tier} shell={shell} interior={interior} />
    );

  // The press target is preserved in every tier, including static -- the
  // fallback must not silently drop interaction.
  if (!interactive) {
    return (
      <View
        style={{ width: tile, height: tile }}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
        accessible
        testID={testID}
      >
        {body}
      </View>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ width: tile, height: tile }}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
        accessibilityHint="Responds to touch."
        accessible
        // A screen reader cannot hold or drag the glass, so its activation
        // gets the whole gesture's answer at once: a full ripple from the
        // centre. Same as a tap, minus the aiming.
        onAccessibilityTap={() => {
          fire({ x: 0, y: 0 }, 1, "light");
          onPress?.({ x: 0, y: 0 });
        }}
        testID={testID}
      >
        {body}
      </View>
    </GestureDetector>
  );
});
