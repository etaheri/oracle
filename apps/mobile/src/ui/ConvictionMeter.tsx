import { useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { Ritual, Mono } from "./Text";
import { colors, space } from "../theme";
import { confidenceReading } from "../game/confidence";
import { decodeFrame, asciiGauge } from "../game/terminalPrint";

// The conviction moment: while the player pulls (or holds), the card's
// center becomes a charged reliquary — a Skia glow in the side's tone that
// swells with the raw pull, a carved Cinzel percentage that materializes
// out of static and strikes on every grid step (in time with the ratchet
// haptics), the oracle's reading, and the gauge printing beneath. Never
// interactive; the card face under it recedes while this speaks.
const DECODE_STEPS = 4;
const DECODE_MS = 60;
const GLOW = 300;

export function ConvictionMeter({ conf, side, pull }: {
  conf: number;
  side: boolean; // true = YES (ultramarine), false = NO (vermilion)
  pull: SharedValue<number>; // raw pull progress −1..1; 0 under hold-to-charge
}) {
  const tone = side ? colors.ultramarine : colors.vermilion;

  // Materialize once: the first number resolves out of symbol static.
  const [decodeStep, setDecodeStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setDecodeStep((s) => {
        if (s + 1 >= DECODE_STEPS) clearInterval(id);
        return s + 1;
      });
    }, DECODE_MS);
    return () => clearInterval(id);
  }, []);

  // Each new conviction step lands with a small scale strike, synced to the
  // selection tick the gesture already fires.
  const pop = useSharedValue(1);
  const prev = useRef(conf);
  useEffect(() => {
    if (conf !== prev.current) {
      prev.current = conf;
      pop.value = withSequence(withTiming(1.1, { duration: 80 }), withTiming(1, { duration: 150 }));
    }
  }, [conf, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  // The glow charges continuously with the pull; under hold-to-charge (no
  // pull) it charges with the conviction itself.
  const charge = (conf - 55) / 40;
  const glowStyle = useAnimatedStyle(() => {
    const p = Math.max(Math.min(1, Math.abs(pull.value)), 0.15 + charge * 0.85);
    return { opacity: 0.3 + p * 0.7, transform: [{ scale: 0.7 + p * 0.5 }] };
  }, [charge]);

  const label = `${conf}%`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", gap: space(2) }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }, glowStyle]}>
        <Canvas style={{ width: GLOW, height: GLOW }}>
          <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2}>
            <RadialGradient c={vec(GLOW / 2, GLOW / 2)} r={GLOW / 2} colors={[`${tone}66`, `${tone}00`]} />
          </Circle>
        </Canvas>
      </Animated.View>
      <Mono size={12} color={tone} letterSpacing={6} style={{ marginRight: -6 }}>{side ? "YES" : "NO"}</Mono>
      <Animated.View style={popStyle}>
        <Ritual bold size={84} color={tone} letterSpacing={2}>{decodeFrame(label, decodeStep, DECODE_STEPS, label)}</Ritual>
      </Animated.View>
      <Mono size={11} color={colors.goldText} letterSpacing={3}>{confidenceReading(conf)}</Mono>
      <Mono size={12} color={tone} letterSpacing={2}>{asciiGauge(charge * 100)}</Mono>
    </View>
  );
}
