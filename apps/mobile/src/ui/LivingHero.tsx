import { View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { useReducedMotion } from "react-native-reanimated";
import { space } from "../theme";
import { orbGlowRgb } from "../game/orbMood";

// The living hero: the VEED alpha loop (both hands + swirling orb) over a
// Skia glow tinted by the crowd's mood (src/game/orbMood.ts). The loop is
// transparent, so the museum ground and the glow read through it.
// Orb center sits at (0.50, 0.47) of the 1000x562 frame.
const ASPECT = 1000 / 562;
const ORB_CX = 0.5;
const ORB_CY = 0.47;

export function LivingHero({ lean }: { lean: number | null }) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const w = width - space(6);
  const h = w / ASPECT;
  const [r, g, b] = orbGlowRgb(lean);

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

  return (
    <View style={{ width: w, height: h }}>
      <Canvas style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} pointerEvents="none">
        <Circle cx={w * ORB_CX} cy={h * ORB_CY} r={h * 0.52}>
          <RadialGradient
            c={vec(w * ORB_CX, h * ORB_CY)}
            r={h * 0.52}
            colors={[`rgba(${r},${g},${b},0.38)`, `rgba(${r},${g},${b},0)`]}
          />
        </Circle>
      </Canvas>
      <Image
        source={require("../../assets/art/hero-loop.webp")}
        contentFit="contain"
        style={{ width: w, height: h }}
        accessible={false}
      />
    </View>
  );
}
