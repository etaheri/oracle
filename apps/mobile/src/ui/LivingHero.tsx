import { useEffect, useRef } from "react";
import { View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { orbGlowRgb } from "../game/orbMood";
import { ORB_CX, ORB_CY, dustRect, handSlot, orbRect, stageSize } from "../game/heroStage";
import { setHeroAnchor } from "../game/bootGate";
import { AsciiDust } from "./TerminalPatina";
import { OrbLayer } from "./OrbLayer";
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

export function LivingHero({ lean, phase = "live" }: { lean: number | null; phase?: HeroPhase }) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const { w, h } = stageSize(width);
  const orb = orbRect(width);
  const dust = dustRect(width);
  const [r, g, b] = orbGlowRgb(lean);

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
        style={{ width: w, aspectRatio: 1408 / 768 }}
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
        <AsciiDust size={dust.w} intensity={0.22} gate={0.18} />
      </View>
      <HandLayer rect={handSlot(width, "left")} side="left" enter={handsEnter} stageWidth={width} delayMs={HANDS_DELAY_MS} />
      <HandLayer rect={handSlot(width, "right")} side="right" enter={handsEnter} stageWidth={width} delayMs={HANDS_DELAY_MS} />
      {/* The orb slot always exists (it is what gets measured); the orb itself
          mounts only once landed, so its loop starts on frame 0 — the frame the
          rite's still was showing. */}
      <View
        ref={slotRef}
        onLayout={publishAnchor}
        pointerEvents="none"
        style={{ position: "absolute", left: orb.x, top: orb.y, width: orb.w, height: orb.h }}
      >
        {phase === "live" && <OrbLayer rect={{ x: 0, y: 0, w: orb.w, h: orb.h }} playing />}
      </View>
    </View>
  );
}
