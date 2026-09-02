// Dynamic Type, capped rather than fluid (refinement spec §4). Home's
// no-shift choreography depends on reserved slots being constants known at
// layout time (CALL_SLOT_H, CLOCK_H, ROW_H); letting chrome scale without a
// ceiling would dissolve it. So chrome grows to a ceiling and the reserved
// slots grow with it by exactly the same factor, while the temple voice —
// the question, the prophecy, the content — scales freely.
export const CHROME_CAP = 1.3;

// Clamped to [1, cap]: chrome never renders smaller than it was designed,
// and never larger than the reserved rows can absorb.
export function cappedScale(fontScale: number, cap: number = CHROME_CAP): number {
  if (!Number.isFinite(fontScale)) return fontScale === Number.POSITIVE_INFINITY ? cap : 1;
  if (fontScale <= 0) return 1;
  return Math.min(Math.max(fontScale, 1), cap);
}

// A reserved row's height at the current scale. Whole pixels — a slot that
// lands on a subpixel is a hairline of drift on every row beneath it.
export function scaledRow(base: number, fontScale: number, cap: number = CHROME_CAP): number {
  return Math.ceil(base * cappedScale(fontScale, cap));
}
