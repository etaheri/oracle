// Fortune arithmetic (design 2026-09-10 §4, amended 2026-09-14 §4). Pure,
// no I/O, integer fortune.
import { CONSTANTS as C } from "./constants";

export const FORTUNE = {
  FOUNDING: 1000,
  STAKE_FRACTION: 0.05,       // ⚙ every call stakes this share of the fortune
  DOUBLE_MULT: 2,             // the player's double (the house's is BIG_ONE_MULT)
  BUST_UNDER: 100,            // ⚙ a fortune under this at settlement busts
  LINE_MARKET_BAND: 0.15,     // ⚙ the line may sit this far from the market price
  LINE_MIN: 0.05,
  LINE_MAX: 0.95,
  HOUSE_FOUNDING: 0,
  // Written to predictions.confidence on every seal (design 2026-09-14 H8).
  // Never shown; keeps the points and Brier readers computing until the
  // column is deleted after the deadline.
  CONFIDENCE_FLAT: 75,
} as const;

export type Outcome = "yes" | "no" | "void";

/** The stake frozen at seal: STAKE_FRACTION of the fortune, doubled on the Big One, floor 1. */
export function stake(fortune: number, isBigOne: boolean): number {
  return Math.max(1, Math.round(fortune * FORTUNE.STAKE_FRACTION * (isBigOne ? C.BIG_ONE_MULT : 1)));
}

/** The stake after the player's double lands on it. */
export function doubledStake(stake: number): number {
  return stake * FORTUNE.DOUBLE_MULT;
}

/** A fortune the house has taken (design 2026-09-14 §4.4). Judged once, at settlement. */
export function busts(fortune: number): boolean {
  return fortune < FORTUNE.BUST_UNDER;
}

/** What a right call pays per unit staked, on top of the stake. */
export function odds(answer: boolean, line: number): number {
  return answer ? (1 - line) / line : line / (1 - line);
}

export function payout(input: { stake: number; answer: boolean; line: number; outcome: Outcome }): number {
  if (input.outcome === "void") return input.stake;
  const won = (input.outcome === "yes") === input.answer;
  if (!won) return 0;
  return input.stake + Math.round(input.stake * odds(input.answer, input.line));
}

export function delta(input: { stake: number; answer: boolean; line: number; outcome: Outcome }): number {
  return payout(input) - input.stake;
}

/** The house line: the Oracle's probability held inside the market band and the absolute bounds. */
export function clampLine(oracleP: number, marketP: number | null): number {
  let lo: number = FORTUNE.LINE_MIN;
  let hi: number = FORTUNE.LINE_MAX;
  if (marketP !== null) {
    lo = Math.max(lo, marketP - FORTUNE.LINE_MARKET_BAND);
    hi = Math.min(hi, marketP + FORTUNE.LINE_MARKET_BAND);
  }
  return Math.min(hi, Math.max(lo, oracleP));
}

/** Σ delta / fortune at the first seal. 0 when there is nothing to divide. */
export function dayReturn(deltas: number[], fortuneAtOpen: number): number {
  if (fortuneAtOpen <= 0 || deltas.length === 0) return 0;
  return deltas.reduce((a, b) => a + b, 0) / fortuneAtOpen;
}

/** The card's readout for one side: the flat stake, and what a right call wins on top of it. */
export function sidePreview(input: { fortune: number; isBigOne: boolean; line: number; answer: boolean }): { stake: number; wins: number } {
  const s = stake(input.fortune, input.isBigOne);
  return { stake: s, wins: Math.round(s * odds(input.answer, input.line)) };
}
