import { Canvas, Circle, Fill, Image, ImageShader, RadialGradient, Shader, useImage, vec } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { ORB_D, ORB_DY } from "./orbTouch";
import { INTERIOR_SIZE, ORB_EFFECT } from "./orbShader";
import { dispersionEnabled, interiorSamples, type OrbTier } from "./orbQuality";

const SHELL = require("../../../assets/art/orb-shell.png");
const INTERIOR = require("../../../assets/art/orb-interior.png");

// How far past the silhouette the halo reaches. The tile clears the orb by
// about 5% a side, so this stays inside it and the canvas never has to grow
// (growing it would move the hero's layout, which heroStage forbids).
const HALO_R = 1.1;

export type OrbUniforms = {
  t: number;
  now: number;
  parallax: number;
  centerDepth: number;
  centerLean: number;
  refraction: number;
  halo: number;
  rippleA: readonly [number, number, number, number];
  rippleB: readonly [number, number, number, number];
};

export function OracleOrbCanvas({
  tile,
  live,
  tier,
}: {
  tile: number;
  live: SharedValue<OrbUniforms>;
  tier: OrbTier;
}) {
  const shell = useImage(SHELL);
  const interior = useImage(INTERIOR);

  const r = (ORB_D * tile) / 2;
  const cx = tile / 2;
  const cy = tile / 2 + ORB_DY * tile;

  const uniforms = useDerivedValue(() => {
    const u = live.value;
    return {
      texSize: [INTERIOR_SIZE, INTERIOR_SIZE],
      c: [cx, cy],
      r,
      t: u.t,
      now: u.now,
      parallax: u.parallax,
      centerDepth: u.centerDepth,
      centerLean: [u.centerLean, u.centerLean * 0.4],
      refraction: u.refraction,
      dispersion: dispersionEnabled(tier) ? 1 : 0,
      samples: interiorSamples(tier),
      rippleA: u.rippleA,
      rippleB: u.rippleB,
    };
  }, [cx, cy, r, tier]);

  // The halo lives outside the silhouette, so it is a Skia layer rather than a
  // shader term -- the shader returns transparent past d = 1 by design.
  const haloOpacity = useDerivedValue(() => live.value.halo, []);

  if (!ORB_EFFECT || !shell || !interior) return null;

  return (
    <Canvas style={{ width: tile, height: tile }} pointerEvents="none">
      {/* The interior, clipped to the circle by the shader itself. */}
      <Fill>
        <Shader source={ORB_EFFECT} uniforms={uniforms}>
          <ImageShader
            image={interior}
            fit="none"
            tx="clamp"
            ty="clamp"
            rect={{ x: 0, y: 0, width: INTERIOR_SIZE, height: INTERIOR_SIZE }}
          />
        </Shader>
      </Fill>
      {/* The shell, over the top, never displaced or filtered. It carries the
          rim, the specular arcs, and the silhouette's antialiasing. */}
      <Image image={shell} x={cx - r} y={cy - r} width={r * 2} height={r * 2} fit="fill" />
      {/* A tight glow just past the rim -- distinct from LivingHero's broad
          mood glow, which sits far behind the whole stage. */}
      <Circle cx={cx} cy={cy} r={r * HALO_R} opacity={haloOpacity}>
        <RadialGradient
          c={vec(cx, cy)}
          r={r * HALO_R}
          colors={["rgba(156,181,209,0)", "rgba(156,181,209,0.22)", "rgba(156,181,209,0)"]}
          positions={[0, 1 / HALO_R - 0.02, 1]}
        />
      </Circle>
    </Canvas>
  );
}
