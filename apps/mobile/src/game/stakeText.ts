// The card's estimate text (design 2026-09-22 §9). Before the seal the card
// shows nothing about the room; after it, the side and what the Oracle
// expected. Money moved to the tray, where the double decision needs it.
// Machine register throughout.
export function lineLabel(line: number | null): string | null {
  if (line === null) return null;
  return `THE ORACLE EXPECTED ${Math.round(line * 100)}% YES`;
}

// How a side is taken, in one line. Two ways in, so two lines: the swipe is
// the seal, but reduced motion turns the gesture off and leaves the buttons,
// and a caption that says "swipe" beside a dead gesture teaches a lie. The
// card and the practice caption both read this, so they can never disagree.
// No trailing period on either: at iPhone width the full stop pushed
// "SWIPE RIGHT FOR YES, LEFT FOR NO." onto a second line under the card
// (assets/hand/hand-card.png). The tap hint drops its own for symmetry.
export const SWIPE_HINT = "SWIPE RIGHT FOR YES, LEFT FOR NO";
export const TAP_HINT = "TAP A SIDE TO SEAL";

export function sealHint(reducedMotion: boolean): string {
  return reducedMotion ? TAP_HINT : SWIPE_HINT;
}

// The receipt under the stage. An unstaked round (no line committed, design
// 2026-09-10 §5.5) has only the side to say.
export function receiptLine(input: { answer: boolean; line: number | null; doubled?: boolean }): string {
  const side = input.answer ? "YES" : "NO";
  const label = lineLabel(input.line);
  if (label === null) return side;
  const body = `${side} · ${label}`;
  return input.doubled ? `${body} · DOUBLED` : body;
}

// The round screen's line per sealed call (design 2026-09-22 §9.2): the side,
// the estimate the player played against, and DOUBLED when it carries the
// double. An unstaked round keeps saying only whose side it is.
export function crowdCallLine(input: { answer: boolean; line: number | null; doubled: boolean }): string {
  if (input.line === null) return `YOU: ${input.answer ? "YES" : "NO"}`;
  return receiptLine({ answer: input.answer, line: input.line, doubled: input.doubled });
}
