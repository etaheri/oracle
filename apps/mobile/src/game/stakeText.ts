import { odds } from "@oracle/core";
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
// No trailing period on either: at iPhone width the full stop pushed
// "SWIPE RIGHT FOR YES, LEFT FOR NO." onto a second line under the card
// (assets/hand/hand-card.png). The tap hint drops its own for symmetry.
export const SWIPE_HINT = "SWIPE RIGHT FOR YES, LEFT FOR NO";
export const TAP_HINT = "TAP A SIDE TO SEAL";

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

// The round screen's line per sealed call (design §5.3, last paragraph): once
// the double is placed the finale must show it, so a staked call prints its
// whole receipt -- side, stake, winnings, and DOUBLED when it carries the
// double. The stake here is the server's frozen one, ALREADY doubled on the
// doubled call, so the winnings price off it directly and need no second
// multiplication. An unstaked round (no line committed, §5.5) has no money to
// print and keeps saying only whose side it is.
export function crowdCallLine(input: { answer: boolean; stake: number | null; line: number | null; doubled: boolean }): string {
  const side = input.answer ? "YES" : "NO";
  if (input.stake === null || input.line === null) return `YOU: ${side}`;
  const wins = Math.round(input.stake * odds(input.answer, input.line));
  return receiptLine({ answer: input.answer, stake: input.stake, wins, doubled: input.doubled });
}
