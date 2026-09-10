import { FORTUNE, LADDER_CONFIDENCES, stakeFraction } from "@oracle/core";
import { formatFortune } from "./fortuneText";
import { numeral } from "./numerals";

// The card's money text (design §8.2, D13). Money, never confidence, on the
// ladder and the receipt; the confidence percent is stored and shown only in
// the record's calibration detail. Machine register throughout.
export function lineLabel(line: number | null): string | null {
  if (line === null) return null;
  return `THE ORACLE'S LINE · ${Math.round(line * 100)}% YES`;
}

export function rungLabel(r: { stake: number; wins: number }): string {
  return `STAKE ${formatFortune(r.stake)} · WINS ${formatFortune(r.wins)}`;
}

export function rungA11y(r: { stake: number; wins: number }): string {
  return `Stake ${formatFortune(r.stake)}, wins ${formatFortune(r.wins)}`;
}

// A round whose line commit missed opens unstaked (design §5.5); the ladder
// still has to say something, so it says the one thing it knows.
export function unstakedRungLabel(confidence: number): string {
  return `${confidence}% SURE`;
}

export function receiptLine(input: { answer: boolean; stake: number | null; wins: number | null; confidence: number }): string {
  const side = input.answer ? "YES" : "NO";
  if (input.stake === null || input.wins === null) return `${side} · ${unstakedRungLabel(input.confidence)}`;
  return `${side} · STAKED ${formatFortune(input.stake)} · WINS ${formatFortune(input.wins)}`;
}

// The five rungs for the rules screen, at a founding fortune.
export function ladderTable(): Array<{ rung: string; percent: string; bigOne: string; example: string }> {
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  return LADDER_CONFIDENCES.map((c, i) => ({
    rung: numeral(i + 1),
    percent: pct(stakeFraction(c, false)),
    bigOne: pct(stakeFraction(c, true)),
    example: formatFortune(Math.round(FORTUNE.FOUNDING * stakeFraction(c, false))),
  }));
}
