import { useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { orbGlowRgb } from "../game/orbMood";
import { haloDwell, haloGate } from "../game/haloMood";
import { ORB_CX, ORB_CY, dustRect, handSlot, orbRect, stageSize } from "../game/heroStage";
import { isOrbLanded, onOrbLanded, setHeroAnchor } from "../game/bootGate";
import { AsciiDust } from "./TerminalPatina";
import { GlassRefraction } from "./GlassRefraction";
import { OracleOrb } from "./orb/OracleOrb";
import { type OrbState } from "./orb/orbState";
import { HandLayer } from "./HandLayer";

// The living hero as a stage of layers (spec 2026-09-01-boot-orb-handoff):
// glow (Skia, mood-tinted) → dust ring → hands → orb. The footprint is the
// old loop's (width × width/1.779) so nothing else on Home moves. On a cold
// start the boot rite's orb slides into the orb slot measured here; the
// phases stagger what is visible so the arrival reads as one motion.
export type HeroPhase = "cold" | "waking" | "live";

const GLOW_DELAY_MS = 300;
const GLOW_MS = 400;
const HANDS_DELAY_MS = 450;

export function LivingHero({ lean, playerCount = 0, phase = "live", greet = false }: { lean: number | null; playerCount?: number; phase?: HeroPhase; greet?: boolean }) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const { w, h } = stageSize(width);
  const orb = orbRect(width);
  const dust = dustRect(width);
  const [r, g, b] = orbGlowRgb(lean);
  // The halo carries the day: density is turnout, restlessness is how split
  // the crowd is (see haloMood). The glass refracts the very same field, so
  // both read the same two values.
  const gate = haloGate(playerCount);
  const hold = haloDwell(lean);
  const dustOrigin: readonly [number, number] = [orb.x - dust.x, orb.y - dust.y];

  // The orb's own state, decoupled from `phase`. It must NOT track `phase`
  // directly ("waking" -> "attending") -- that seeds a brand-new OracleOrb
  // instance already fully lit while the boot rite's dormant orb is still
  // sliding on top of it, and OracleOrb's own "waking" rise never plays
  // because it would already be sitting at its destination. Instead: mount
  // dormant (identical to the rite's still, so the two orbs match for the
  // whole slide), then flip to waking exactly when the rite's orb lands --
  // OracleOrb settles waking into attending on its own after the rise.
  // A warm remount that observes the orb already landed (isOrbLanded() true
  // at mount) skips the rise entirely -- there is no rite orb to sync with.
  const [orbState, setOrbState] = useState<OrbState>(() => (isOrbLanded() ? "attending" : "dormant"));
  useEffect(() => onOrbLanded(() => setOrbState((s) => (s === "dormant" ? "waking" : s))), []);

  // Anchor: the orb slot's rect in window coordinates, republished on every
  // layout so the rite reads a settled value at `done`.
  const slotRef = useRef<View>(null);
  const publishAnchor = () => {
    slotRef.current?.measureInWindow((x, y, mw, mh) => {
      if (mw > 0 && mh > 0) setHeroAnchor({ x, y, w: mw, h: mh });
    });
  };

  // Glow: 0 while cold or waking (fades up 300ms after the rite's `done`,
  // driven by the effect below); 1 when mounted straight into live.
  const glow = useSharedValue(phase === "live" ? 1 : 0);
  useEffect(() => {
    if (phase === "waking") glow.value = withDelay(GLOW_DELAY_MS, withTiming(1, { duration: GLOW_MS, easing: Easing.out(Easing.quad) }));
    else if (phase === "live") glow.value = withTiming(1, { duration: GLOW_MS });
  }, [phase, glow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  if (reducedMotion) {
    // Still world: the graded still frame, no glow behind it.
    return (
      <Image
        source={require("../../assets/art/creation-hands-orb.jpg")}
        contentFit="cover"
        // The stage's height, not the still's own 1408/768 — a reduced-motion
        // hero that is 6px shorter than the animated one would place the
        // wordmark and epigraph on different rows for different users.
        style={{ width: w, height: h }}
        accessible={false}
      />
    );
  }

  const handsEnter = phase !== "cold";

  return (
    <View style={{ width: w, height: h }}>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: w, height: h }, glowStyle]} pointerEvents="none">
        <Canvas style={{ width: w, height: h }}>
          <Circle cx={w * ORB_CX} cy={h * ORB_CY} r={h * 0.52}>
            <RadialGradient
              c={vec(w * ORB_CX, h * ORB_CY)}
              r={h * 0.52}
              colors={[`rgba(${r},${g},${b},0.38)`, `rgba(${r},${g},${b},0)`]}
            />
          </Circle>
        </Canvas>
      </Animated.View>
      {/* Patina halo: sparse glyphs collect around the orb, between the glow
          and the artwork — the hands and orb paint over them (brief §4: ASCII
          never obscures anatomy). */}
      <View pointerEvents="none" style={{ position: "absolute", left: dust.x, top: dust.y }}>
        <AsciiDust size={dust.w} intensity={0.22} gate={gate} hold={hold} />
      </View>
      <HandLayer rect={handSlot(width, "left")} side="left" enter={handsEnter} stageWidth={width} delayMs={HANDS_DELAY_MS} />
      <HandLayer rect={handSlot(width, "right")} side="right" enter={handsEnter} stageWidth={width} delayMs={HANDS_DELAY_MS} />
      {/* The orb slot always exists — it's what gets measured for the boot
          rite's anchor. The orb mounts from waking onward, dormant, so the
          Skia decode is warm and the slot is real before the handoff; it
          rises to attending once the rite's orb lands (see orbState above).
          It is not DRAWN until then, though: during `waking` the rite's orb
          is still in flight toward this exact slot, and painting ours here
          as well put a second, identical orb at the destination while the
          first was still travelling to it. Opacity, not conditional render —
          the mount is the whole point, and opacity changes neither layout
          nor measureInWindow. */}
      <View
        ref={slotRef}
        onLayout={publishAnchor}
        style={{ position: "absolute", left: orb.x, top: orb.y, width: orb.w, height: orb.h }}
      >
        {phase !== "cold" && (
          <View
            style={{ opacity: phase === "live" ? 1 : 0 }}
            // An orb nobody can see must not take a tap either — the rite's
            // own skip target owns every touch until it hands off.
            pointerEvents={phase === "live" ? "auto" : "none"}
          >
            <OracleOrb
              tile={orb.w}
              state={orbState}
              interactive
              greet={greet}
              accessibilityLabel="Oracle"
            />
          </View>
        )}
      </View>
      {/* Above the orb, never behind it: refracted glyphs are light inside the
          glass. Only once the orb is actually here — there is nothing to
          refract through while the rite still holds it. */}
      {phase === "live" && (
        <GlassRefraction rect={orb} origin={dustOrigin} gate={gate} hold={hold} />
      )}
    </View>
  );
}
