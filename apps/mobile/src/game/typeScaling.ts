// Dynamic Type, capped rather than fluid (refinement spec §4). Home's
// no-shift choreography depends on reserved slot heights being known before
// their contents arrive; letting chrome scale without a ceiling would
// dissolve it. So chrome grows to a ceiling and the reserved slots grow with
// it by exactly the same factor (see scaledRow), while the temple voice —
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

// How many lines of CONTENT to allow at the current text size.
//
// The counterpart to scaledRow, and the fix for its blind spot. Chrome is
// capped and its reserved rows grow with it; content scales freely — but
// content clamped with a fixed `numberOfLines` gets worse as the reader turns
// their text size up, because each line then holds fewer words while the line
// budget stays put. The reveal's question rows and the crowd finale both did
// this, so the accessibility setting that exists to make text readable was
// quietly deleting the end of every long question.
//
// Uncapped on purpose: both surfaces are inside scrollers, so the cost of a
// taller row is a scroll, and the cost of a short one is a truncated question.
export function scaledLines(base: number, fontScale: number): number {
  if (!Number.isFinite(fontScale) || fontScale <= 1) return base;
  return Math.max(base, Math.round(base * fontScale));
}
