// The halo carries the day's crowd. Density is turnout — the computation
// around the orb literally gets busier as more people ask it something — and
// restlessness is disagreement: a split crowd makes the cells re-roll fast, a
// crowd that agrees lets them settle. Pure, so node tests never import Skia.

const DENSITY_FLOOR = 0.14; // an empty day: a few glyphs, mostly stillness
const DENSITY_CEIL = 0.34; // a full one; past this the brief's "sparse" breaks
// Turnout is logarithmic: the first hundred players should feel like a crowd
// arriving, the five hundredth should not have to double it again.
const TURNOUT_FULL = 500;

export function haloGate(playerCount: number): number {
  if (!Number.isFinite(playerCount) || playerCount <= 0) return DENSITY_FLOOR;
  const k = Math.min(1, Math.log10(1 + playerCount) / Math.log10(1 + TURNOUT_FULL));
  return DENSITY_FLOOR + (DENSITY_CEIL - DENSITY_FLOOR) * k;
}

// Per-cell dwell range, in seconds. `lean` is the crowd's average YES
// percentage (0-100), or null before the player has sealed anything and the
// anti-herding wall still holds — an unknown crowd dwells at the calm default.
export function haloDwell(lean: number | null): readonly [number, number] {
  if (lean === null) return [2, 6];
  const t = Math.min(100, Math.max(0, lean));
  const split = 1 - Math.abs(t - 50) / 50; // 1 = dead split, 0 = unanimous
  return [2.6 - 1.4 * split, 7 - 3.5 * split];
}
