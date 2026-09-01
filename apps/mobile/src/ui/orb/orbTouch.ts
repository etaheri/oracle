// Touch, in the orb's own terms. Pure: the tests must never load Skia.
//
// The tile is a square from the hero stage; the orb is a circle inside it,
// at frame 0's measured diameter and centre (see the design doc's Geometry
// section). Everything downstream — ripple origins, hit testing — speaks the
// normalized [-1, 1] coordinates this produces.

// Fractions of the tile's side. The orb never deviates from these at runtime:
// the silhouette is fixed by construction, not by animation discipline.
export const ORB_D = 0.897;
export const ORB_DY = -0.0177;

export type OrbPoint = { x: number; y: number };
export type OrbHit = { local: OrbPoint; normal: readonly [number, number, number] };

export function locate(touch: OrbPoint, tile: number): OrbHit | null {
  if (!Number.isFinite(tile) || tile <= 0) return null;
  if (!Number.isFinite(touch.x) || !Number.isFinite(touch.y)) return null;

  const r = (ORB_D * tile) / 2;
  const cx = tile / 2;
  const cy = tile / 2 + ORB_DY * tile;
  const x = (touch.x - cx) / r;
  const y = (touch.y - cy) / r;

  const d2 = x * x + y * y;
  // Outside the silhouette is not a touch on the orb — the tile's corners
  // belong to the hero, not to the glass.
  if (d2 > 1) return null;

  // Front-facing sphere normal. z falls to 0 at the rim, so a touch there
  // leans entirely across the surface rather than into it.
  const z = Math.sqrt(Math.max(0, 1 - d2));
  const len = Math.hypot(x, y, z) || 1;
  return { local: { x, y }, normal: [x / len, y / len, z / len] };
}
