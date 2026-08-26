// The orb holds the crowd's mood. Anti-herding wall stays intact: lean is
// computed only from questions the player has already sealed, so the orb is
// neutral until the player commits, then drifts as the crowd is revealed.
// Color anchors mirror the brief tokens lavender/warmCenter/glassBlue (kept
// literal here so node tests never import RN modules).
const NEUTRAL = [183, 169, 228] as const; // lavender — unknown or split crowd
const COOL = [156, 181, 209] as const; // glassBlue — crowd leans NO
const WARM = [242, 190, 145] as const; // warmCenter — crowd leans YES

export function crowdLean(entries: ReadonlyArray<{ crowd_yes_pct: number }>): number | null {
  if (entries.length === 0) return null;
  return entries.reduce((s, e) => s + e.crowd_yes_pct, 0) / entries.length;
}

export function orbGlowRgb(lean: number | null): readonly [number, number, number] {
  if (lean === null) return NEUTRAL;
  const t = Math.min(100, Math.max(0, lean));
  const [from, to, k] = t < 50 ? [COOL, NEUTRAL, t / 50] : [NEUTRAL, WARM, (t - 50) / 50];
  return [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * k)) as unknown as readonly [number, number, number];
}
