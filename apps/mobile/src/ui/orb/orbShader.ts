import { Skia } from "@shopify/react-native-skia";

// The orb's interior. The shader never authors colour -- it samples the
// reference's own interior field and displaces the sample coordinate. At
// baseline every warp term is zero, so the composite is pixel-identical to
// the canonical image by construction rather than by tuning.
//
// The shell raster is drawn OVER this, untouched, and carries the rim, the
// specular arcs, and the silhouette's antialiasing.

export const INTERIOR_SIZE = 256;

const ORB_SKSL = `
uniform shader interior;
uniform float2 texSize;
uniform float2 c;          // orb centre, in canvas pixels
uniform float r;           // orb radius, in canvas pixels
uniform float t;           // the orb's own drift time, scaled by timeScale
uniform float now;         // unscaled seconds -- ripples answer a human touch
                           // and must not slow down when the orb's drift does
uniform float parallax;
uniform float centerDepth;
uniform float2 centerLean;
uniform float refraction;
uniform float dispersion;
uniform float samples;     // 2 = high tier, 1 = reduced
uniform float4 rippleA;    // xy origin in [-1,1], z start seconds, w strength
uniform float4 rippleB;
uniform float3 contact;    // xy fingertip in [-1,1], z strength -- 0 when
                           // nothing is touching the glass

const float RIPPLE_LIFE = 1.3;
// How deep the fingertip presses. Small: the interior yields, it does not
// dent. A tenth of this is already visible against a low-frequency field.
const float CONTACT_DEPTH = 0.075;
// The well's tightness. High enough that the lens is plainly a fingertip and
// not a second warm centre.
const float CONTACT_FALLOFF = 11.0;

float2 uvFor(float2 q) {
  return (q * 0.5 + 0.5) * texSize;
}

// A travelling band over the approximated sphere. Smooth falloff, no rings.
float2 rippleWarp(float2 p, float4 rp, float atTime) {
  if (rp.w <= 0.0) { return float2(0.0); }
  float age = atTime - rp.z;
  if (age < 0.0 || age > RIPPLE_LIFE) { return float2(0.0); }
  float2 away = p - rp.xy;
  float dist = length(away);
  if (dist < 1e-4) { return float2(0.0); }
  // The front leaves the touch and crosses the interior over the ripple's life.
  float front = (age / RIPPLE_LIFE) * 2.2;
  // Squared directly: pow() with a negative base is undefined, and
  // (dist - front) is negative everywhere ahead of the travelling front.
  float e = (dist - front) * 3.2;
  float band = exp(-e * e);
  // The first 80ms compress inward; the wave then expands outward. That sign
  // flip IS the local optical compression the brief asks for.
  float compress = mix(-1.0, 1.0, smoothstep(0.0, 0.08, age));
  float decay = 1.0 - smoothstep(0.7, RIPPLE_LIFE, age);
  return normalize(away) * band * decay * compress * rp.w * 0.09;
}

// The interior yielding under a fingertip. The sample coordinate is pulled
// TOWARD the contact, which magnifies the field beneath it -- a lens pressed
// into soft glass, not a highlight painted on top of it. It follows the
// finger exactly; the warm centre is what lags behind, and that lag is the
// wake.
float2 contactLens(float2 p, float3 ct) {
  if (ct.z <= 0.0) { return float2(0.0); }
  float2 away = p - ct.xy;
  float dist = length(away);
  if (dist < 1e-4) { return float2(0.0); }
  float well = exp(-dist * dist * CONTACT_FALLOFF);
  return -normalize(away) * well * ct.z * CONTACT_DEPTH;
}

half4 main(float2 xy) {
  float2 p = (xy - c) / r;
  float d2 = dot(p, p);
  // Outside the silhouette the interior contributes nothing; the shell owns
  // the edge.
  if (d2 >= 1.0) { return half4(0.0); }
  float z = sqrt(max(0.0, 1.0 - d2));

  // Interior-only refraction: (1 - z) is the glass's steepness, zero dead
  // centre and one at the rim, so the field crowds toward the silhouette.
  float2 refr = p * refraction * (1.0 - z) * 0.10;

  // The warm centre. A positive centerDepth scales the sample outward, which
  // spreads the centre and reads as receding; it never scales toward the
  // origin, so the centre cannot collapse into a dot.
  float core = exp(-d2 * 3.0);
  float2 depth = p * centerDepth * core;
  float2 lean = centerLean * core;

  float2 ripple = rippleWarp(p, rippleA, now) + rippleWarp(p, rippleB, now);
  float2 lens = contactLens(p, contact);

  float2 base = p + refr + depth - lean + ripple + lens;

  // Two interior layers drifting in opposition. The field is smooth and
  // low-frequency, so a double sample reads as depth rather than as a ghost.
  float2 driftA = float2(sin(t * 0.11), cos(t * 0.09)) * parallax * 0.045 * (1.0 - z);
  float2 driftB = float2(cos(t * 0.07), sin(t * 0.13)) * parallax * -0.030 * (1.0 - z);

  half4 layerA = interior.eval(uvFor(base + driftA));
  half4 col = layerA;
  if (samples > 1.5) {
    half4 layerB = interior.eval(uvFor(base + driftB));
    col = mix(layerA, layerB, half(0.5));
  }

  // Dispersion: the paths coincide in the middle and separate only where the
  // glass is steep. Physical, not an RGB split.
  if (dispersion > 0.0) {
    float k = dispersion * (1.0 - z) * 0.012;
    half rr = interior.eval(uvFor(base * (1.0 + k))).r;
    half bb = interior.eval(uvFor(base * (1.0 - k))).b;
    col = half4(rr, col.g, bb, col.a);
  }

  return col;
}`;

// Guarded, not asserted: a compile failure costs the interior, not the app.
let effect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
try {
  effect = Skia.RuntimeEffect.Make(ORB_SKSL);
} catch (e) {
  console.error("Oracle orb SkSL failed to compile:", e);
}
if (!effect) console.error("Oracle orb SkSL produced no effect; falling back to the static orb.");

export const ORB_EFFECT = effect;

export function orbCompiled(): boolean {
  return ORB_EFFECT !== null;
}
