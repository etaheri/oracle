import { Canvas, Fill, ImageShader, Shader, Skia, useClock, useImage } from "@shopify/react-native-skia";
import { useDerivedValue, useReducedMotion } from "react-native-reanimated";
import type { Rect } from "../game/heroStage";

// Glass reflection (brand brief §4, the one approved ASCII behavior that was
// never built): "tiny curved rows of ASCII are refracted inside selected glass
// highlights". The orb stops being a flat tile and starts behaving like a ball
// lens — the halo's glyph field is re-evaluated along refracted paths, so the
// dust visibly bends and compresses as it passes the rim, with the two paths
// separating into warm and cool only where the glass is steepest.
//
// The field is procedural, which is what makes this possible at all: there is
// no texture of the halo to sample, so "refracting the dust" means evaluating
// the same hash-and-dwell function the halo uses at bent coordinates. Same
// material, bent by the glass.
//
// This layer sits ABOVE the orb tile — the light belongs inside the glass, not
// behind it — and paints nothing outside the silhouette or over the warm
// centre, both of which the brief protects.
const ATLAS = require("../../assets/art/ascii-atlas.png");
const ATLAS_W = 768;
const ATLAS_H = 128;
const GLYPH_COUNT = 8;

// The glass's polar grid: 44 glyphs around, 13 rings from centre to
// silhouette. Tuned against the orb's real size (~120 logical px on a modern
// phone): finer than this and the glyphs stop being identifiable as characters
// and read as grain — which is precisely the ASCII that "immediately
// dominates" the brief warns against. Legible beats dense.
const ANG_DIV = 34;
const RAD_DIV = 10;

// The orb tile clears the swollen orb by ~9px a side (see heroStage), so the
// glass itself is a touch inside the tile.
const GLASS_R = 0.45;
// Where the tile's specular sits, as a fraction of the glass radius from its
// centre. Only its bearing is used — the arcs are angular, so a highlight that
// drifts a little as the orb's loop swells never falls out of registration.
const HI_X = -0.41;
const HI_Y = -0.26;

const REFRACT_SKSL = `
uniform shader glyphAtlas;
uniform float2 atlasSize;
uniform float glyphCount;
uniform float angDiv;
uniform float radDiv;
uniform float t;
uniform float2 hold;
uniform float gate;
uniform float intensity;
uniform float2 c;
uniform float r;
uniform float bend;
uniform float2 origin;
uniform float4 warm;
uniform float4 cool;
uniform float hiAng;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// One evaluation of the halo's own glyph field, in the glass's polar cell
// space. Same per-cell dwell clock as AsciiDust, so the glass and the air
// around it are visibly the same material, ticking on the same hidden clock.
// The angular axis wraps, so there is no seam at the twelve o'clock join.
float fieldAt(float2 pc, float g) {
  float2 cellID = float2(floor(mod(pc.x, angDiv)), floor(pc.y));
  float2 uv = fract(pc);
  float sd = hash21(cellID * 3.1);
  float myHold = mix(hold.x, hold.y, sd);
  float tick = floor(t / myHold + sd);
  float show = step(1.0 - g, hash21(cellID + tick));
  float idx = 1.0 + floor(hash21(cellID * 1.7 + tick * 0.37) * (glyphCount - 1.0));
  idx = min(idx, glyphCount - 1.0);
  float gw = atlasSize.x / glyphCount;
  return glyphAtlas.eval(float2(idx * gw + uv.x * gw, uv.y * atlasSize.y)).a * show;
}

half4 main(float2 xy) {
  float2 p = (xy - c) / r;
  float d = length(p);
  if (d >= 1.0) { return half4(0.0); }
  float z = sqrt(max(0.0, 1.0 - d * d));

  // The warm centre stays completely clear (brief §1: "keep the orb's warm
  // center completely clear"); the rows live in the rim annulus and fade again
  // just inside the silhouette so nothing spills past the glass.
  float rim = smoothstep(0.30, 0.80, d) * (1.0 - smoothstep(0.90, 1.0, d));
  if (rim <= 0.001) { return half4(0.0); }

  // The field goes POLAR inside the glass. A Cartesian field sampled at bent
  // coordinates is mathematically refracted but perceptually just scattered —
  // there is no structure left to read the bend against. Rows that follow the
  // glass give the eye something to see compress, which is also exactly what
  // the brief asks for: "tiny curved rows of ASCII".
  float ang = atan(p.y, p.x);
  // Ball-lens refraction: (1 - z) is the glass's steepness, zero dead centre
  // and one at the silhouette, so the rings crowd together toward the rim.
  float k = bend * (1.0 - z);
  float rw = d * (1.0 + k * 0.92);
  float rc = d * (1.0 + k * 1.10);

  // Two arcs, not a ring. Filling the whole annulus turned the glass frosted
  // and buried the orb's own reflections; the brief localises this to
  // "selected glass highlights" and wants ASCII discovered, not dominant. One
  // broad arc through the specular, one narrow answering arc opposite it.
  float da = mod(ang - hiAng + 9.42477796077, 6.28318530718) - 3.14159265359;
  float arc = max(
    1.0 - smoothstep(0.55, 1.45, abs(da)),
    0.55 * (1.0 - smoothstep(0.15, 0.75, abs(abs(da) - 3.14159265359)))
  );
  if (arc <= 0.001) { return half4(0.0); }

  float aw = angDiv / 6.28318530718;
  // Denser than the open air, because the lens is concentrating two radii of
  // halo into this band — but capped, or the glass frosts over and buries the
  // orb's own reflections.
  float g = min(0.72, gate * 2.6);

  // Dispersion: the two paths coincide in the middle and separate only where
  // the glass is steep — physical, not an RGB split.
  float aW = fieldAt(float2(ang * aw, rw * radDiv), g);
  float aC = fieldAt(float2(ang * aw, rc * radDiv), g);

  half amp = half(rim * arc * intensity);
  // The warm path is a fringe, not a second colour: at parity the orange read
  // as chroma noise on the glass rather than dispersion through it.
  half aWr = half(aW) * amp * half(0.35);
  half aCr = half(aC) * amp;
  half a = min(half(1.0), aWr + aCr);
  half3 rgb = half3(warm.rgb) * aWr + half3(cool.rgb) * aCr;
  // Premultiplied: never let colour outrun the alpha carrying it.
  return half4(min(rgb, half3(a)), a);
}`;

// Guarded, not asserted (brief §11): a compile failure costs the refraction,
// not the app.
let effect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
try {
  effect = Skia.RuntimeEffect.Make(REFRACT_SKSL);
} catch (e) {
  console.error("Glass refraction SkSL failed to compile:", e);
}

const WARM = [242 / 255, 190 / 255, 145 / 255, 1] as const; // warmCenter
const COOL = [156 / 255, 181 / 255, 209 / 255, 1] as const; // glassBlue

export function GlassRefraction({
  rect,
  origin,
  gate,
  hold,
  intensity = 0.7,
  bend = 0.95,
}: {
  // The orb tile, in the hero stage's coordinates.
  rect: Rect;
  // Offset from the tile's origin to the halo field's, so the glass bends the
  // same field the surrounding air is drawing rather than a parallel one.
  origin: readonly [number, number];
  gate: number;
  hold: readonly [number, number];
  intensity?: number;
  bend?: number;
}) {
  const atlas = useImage(ATLAS);
  const clock = useClock();
  const reducedMotion = useReducedMotion();

  const uniforms = useDerivedValue(() => ({
    atlasSize: [ATLAS_W, ATLAS_H],
    glyphCount: GLYPH_COUNT,
    angDiv: ANG_DIV,
    radDiv: RAD_DIV,
    // Reduced motion freezes the field rather than dropping it: a still
    // refracted crust is the accessible version of the same artifact.
    t: reducedMotion ? 1 : clock.value / 1000,
    hold: [hold[0], hold[1]],
    gate,
    intensity,
    c: [rect.w / 2, rect.h / 2],
    r: rect.w * GLASS_R,
    bend,
    origin: [origin[0], origin[1]],
    warm: WARM,
    cool: COOL,
    hiAng: Math.atan2(HI_Y, HI_X),
  }), [rect.w, rect.h, origin, gate, hold, intensity, bend, reducedMotion]);

  if (!effect || !atlas) return null;
  return (
    <Canvas style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}
