import { formatFortune } from "./fortuneText";

// The card's money text (design 2026-09-14 §5.1). Money, never a percent:
// the flat stake and what it wins on each side. Machine register throughout.
export function lineLabel(line: number | null): string | null {
  if (line === null) return null;
  return `THE ORACLE'S LINE · ${Math.round(line * 100)}% YES`;
}

// One side's stake and winnings. The Big One names itself, because its
// stake is the one that is already doubled before the player's double.
export function sideLine(_answer: boolean, stake: number, wins: number, isBigOne: boolean): string {
  const body = `STAKE ${formatFortune(stake)} · WINS ${formatFortune(wins)}`;
  return isBigOne ? `THE BIG ONE · ${body}` : body;
}

// How a side is taken, in one line. Two ways in, so two lines: the swipe is
// the seal, but reduced motion turns the gesture off and leaves the buttons,
// and a caption that says "swipe" beside a dead gesture teaches a lie. The
// card and the practice caption both read this, so they can never disagree.
export const SWIPE_HINT = "SWIPE RIGHT FOR YES, LEFT FOR NO.";
export const TAP_HINT = "TAP A SIDE TO SEAL.";

export function sealHint(reducedMotion: boolean): string {
  return reducedMotion ? TAP_HINT : SWIPE_HINT;
}

// The receipt under the stage. An unstaked round (no line committed, design
// §5.5) has only the side to say.
export function receiptLine(input: { answer: boolean; stake: number | null; wins: number | null; doubled?: boolean }): string {
  const side = input.answer ? "YES" : "NO";
  if (input.stake === null || input.wins === null) return side;
  const body = `${side} · STAKED ${formatFortune(input.stake)} · WINS ${formatFortune(input.wins)}`;
  return input.doubled ? `${body} · DOUBLED` : body;
}
