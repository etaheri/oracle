import { View, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { colors } from "../theme";

// The card's charge: a Skia glow in the side's tone that swells with the
// raw pull (or with conviction itself under hold-to-charge). The number
// and the fill live OFF the card in the stationary ConvictionColumn — the
// card only glows, because the card is the thing that moves.
const GLOW = 300;

export function ConvictionMeter({ conf, side, pull }: {
  conf: number;
  side: boolean; // true = YES (ultramarine), false = NO (vermilion)
  pull: SharedValue<number>; // raw pull progress −1..1; 0 under hold-to-charge
}) {
  const tone = side ? colors.ultramarine : colors.vermilion;
  const charge = (conf - 55) / 40;
  const glowStyle = useAnimatedStyle(() => {
    const p = Math.max(Math.min(1, Math.abs(pull.value)), 0.15 + charge * 0.85);
    return { opacity: 0.3 + p * 0.7, transform: [{ scale: 0.7 + p * 0.5 }] };
  }, [charge]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }, glowStyle]}>
        <Canvas style={{ width: GLOW, height: GLOW }}>
          <Circle cx={GLOW / 2} cy={GLOW / 2} r={GLOW / 2}>
            <RadialGradient c={vec(GLOW / 2, GLOW / 2)} r={GLOW / 2} colors={[`${tone}66`, `${tone}00`]} />
          </Circle>
        </Canvas>
      </Animated.View>
    </View>
  );
}
