import { Canvas, Circle, Fill, Image, ImageShader, RadialGradient, Shader, vec, type SkImage } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { ORB_D, ORB_DY } from "./orbTouch";
import { INTERIOR_SIZE, ORB_EFFECT } from "./orbShader";
import { dispersionEnabled, interiorSamples, type OrbTier } from "./orbQuality";

// How far past the silhouette the halo reaches, as a multiple of the
// silhouette radius r. The canvas must never grow -- that would move the
// hero's layout, which heroStage forbids -- so this is capped by whichever
// tile edge the halo circle would hit first. ORB_DY moves the orb's centre
// up, so the top is the tight edge: it clears the centre by (0.5 + ORB_DY)
// tile-units, against a silhouette radius of ORB_D/2. HALO_SAFETY keeps a
// visible margin so the glow fades to nothing before the canvas bound,
// rather than being clipped by a hard edge mid-gradient.
const CENTER_TO_TOP = 0.5 + ORB_DY;
const SILHOUETTE_R = ORB_D / 2;
const HALO_SAFETY = 0.02;
const HALO_R = (CENTER_TO_TOP - HALO_SAFETY) / SILHOUETTE_R;
// Where the silhouette's own edge falls within the halo circle's [0, 1]
// gradient radius. The gradient must stay fully transparent out to this
// point -- the halo is drawn over the opaque shell, so any alpha at or
// inside the silhouette washes the raster rather than glowing past it.
const HALO_RIM = 1 / HALO_R;
const HALO_PEAK = HALO_RIM + (1 - HALO_RIM) * 0.5;

export type OrbUniforms = {
  t: number;
  now: number;
  parallax: number;
  centerDepth: number;
  // A true vector now, not a scalar with a baked-in direction: a finger on
  // the glass leans the warm centre toward itself, and that direction is
  // wherever the finger is. orbState.leanVector composes it.
  centerLean: readonly [number, number];
  refraction: number;
  halo: number;
  rippleA: readonly [number, number, number, number];
  rippleB: readonly [number, number, number, number];
  // xy fingertip in [-1,1], z strength. All zero when nothing is touching.
  contact: readonly [number, number, number];
};

export function OracleOrbCanvas({
  tile,
  live,
  tier,
  shell,
  interior,
}: {
  tile: number;
  live: SharedValue<OrbUniforms>;
  tier: OrbTier;
  shell: SkImage | null;
  interior: SkImage | null;
}) {
  const r = (ORB_D * tile) / 2;
  const cx = tile / 2;
  const cy = tile / 2 + ORB_DY * tile;

  // Computed on the JS thread: dispersionEnabled/interiorSamples are plain
  // functions, not worklets, so the derived value below must capture their
  // results rather than call them -- Reanimated cannot synchronously call a
  // non-worklet JS function from the UI runtime.
  const dispersion = dispersionEnabled(tier) ? 1 : 0;
  const samples = interiorSamples(tier);

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
      centerLean: u.centerLean,
      refraction: u.refraction,
      dispersion,
      samples,
      rippleA: u.rippleA,
      rippleB: u.rippleB,
      contact: u.contact,
    };
  }, [cx, cy, r, dispersion, samples]);

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
          colors={[
            "rgba(156,181,209,0)",
            "rgba(156,181,209,0)",
            "rgba(156,181,209,0.22)",
            "rgba(156,181,209,0)",
          ]}
          positions={[0, HALO_RIM, HALO_PEAK, 1]}
        />
      </Circle>
    </Canvas>
  );
}
