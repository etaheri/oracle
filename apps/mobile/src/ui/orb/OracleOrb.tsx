import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useClock, useImage, type DataSourceParam, type SkImage } from "@shopify/react-native-skia";
import { locate, type OrbPoint } from "./orbTouch";
import { assign, EMPTY_SLOTS, type RippleSlots } from "./orbRipples";
import { nextState, settleTo, isTransient, targetsFor, transitionMs, type OrbState } from "./orbState";
import { resolve, rippleCapacity, type OrbQualityProp } from "./orbQuality";
import { orbCompiled } from "./orbShader";
import { OracleOrbCanvas, type OrbUniforms } from "./OracleOrbCanvas";

const FALLBACK = require("../../../assets/art/orb-fallback.png");
const SHELL = require("../../../assets/art/orb-shell.png");
const INTERIOR = require("../../../assets/art/orb-interior.png");

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
  accessibilityLabel?: string;
  testID?: string;
  onPress?(local: OrbPoint): void;
}>(function OracleOrb(
  { tile, state = "attending", quality = "auto", interactive = false, accessibilityLabel = "Oracle", testID, onPress },
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
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      paused.value = s === "active" ? 0 : 1;
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
    return {
      t: elapsed.value,
      now,
      parallax: parallax.value,
      centerDepth: centerDepth.value,
      centerLean: centerLean.value,
      refraction: refraction.value,
      halo: halo.value,
      rippleA: rippleA.value,
      rippleB: rippleB.value,
    };
  }, []);

  const fire = useCallback(
    (local: OrbPoint) => {
      const capacity = rippleCapacity(tier);
      if (capacity === 0) return;
      const nowMs = Date.now();
      const nowSec = clock.value / 1000;
      slots.current = assign(slots.current, { origin: local, startMs: nowMs, strength: 1 }, nowMs, capacity);
      const pack = (i: 0 | 1): readonly [number, number, number, number] => {
        const r = slots.current[i];
        if (!r) return [0, 0, 0, 0];
        // The shader's clock is in the same seconds the uniforms carry, so a
        // ripple's start is expressed there, not in wall time.
        return [r.origin.x, r.origin.y, r.startMs === nowMs ? nowSec : nowSec - (nowMs - r.startMs) / 1000, r.strength];
      };
      rippleA.value = pack(0);
      rippleB.value = pack(1);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [tier, clock, rippleA, rippleB],
  );

  useImperativeHandle(
    ref,
    () => ({
      ripple: (local) => fire(local ?? { x: 0, y: 0 }),
      transitionTo: (s) => setCurrent((c) => nextState(c, s)),
      settle: () => setCurrent((c) => settleTo(c)),
    }),
    [fire],
  );

  const handlePress = useCallback(
    (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      const hit = locate({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, tile);
      // A press on the tile's corner is not a press on the glass.
      if (!hit) return;
      fire(hit.local);
      onPress?.(hit.local);
    },
    [tile, fire, onPress],
  );

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
    <Pressable
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      testID={testID}
      style={{ width: tile, height: tile }}
    >
      {body}
    </Pressable>
  );
});
