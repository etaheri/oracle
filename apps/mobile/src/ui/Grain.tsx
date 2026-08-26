import { StyleSheet, useWindowDimensions } from "react-native";
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue, useReducedMotion } from "react-native-reanimated";

// Signature shader #1 (design spec §7, quieted per brief §3): mineral grain +
// faint plaster mottle + gentle ambient falloff. Perceived subconsciously —
// the museum white stops being flat #hex without the texture ever reading as
// a feature.
const GRAIN_SKSL = `
uniform float2 res;
uniform float t;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

half4 main(float2 xy) {
  float2 uv = xy / res;
  float g = hash(xy + float2(t, t * 1.7));
  float mottle = vnoise(xy / 130.0);
  float2 c = uv - 0.5;
  float vig = smoothstep(0.62, 1.15, length(c) * 1.6);

  half4 mineral = half4(0.09, 0.10, 0.12, 1.0);
  half4 plaster = half4(1.0, 0.995, 0.975, 1.0);

  half fleck = half(g - 0.5);
  half4 col = fleck > 0.0 ? plaster * fleck * 0.035 : mineral * (-fleck) * 0.04;
  col += mineral * half(mottle) * 0.014;
  col += mineral * half(vig) * 0.05;
  return col;
}`;

const effect = Skia.RuntimeEffect.Make(GRAIN_SKSL)!;

export function Grain() {
  const { width, height } = useWindowDimensions();
  const clock = useClock();
  const reducedMotion = useReducedMotion();

  // Grain re-seeds at ~12fps (film cadence); quantizing the uniform also
  // caps shader repaints at 12/s instead of 60.
  const uniforms = useDerivedValue(() => ({
    res: [width, height],
    t: reducedMotion ? 1 : Math.floor(clock.value / 83),
  }), [width, height, reducedMotion]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
