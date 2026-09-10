// Fortune arithmetic (design 2026-09-10 §4). Pure, no I/O, integer fortune.
import { CONSTANTS as C } from "./constants";

export const FORTUNE = {
  FOUNDING: 1000,
  STAKE_FRACTION_MAX: 0.10,   // ⚙ fraction of fortune at confidence 100
  LINE_MARKET_BAND: 0.15,     // ⚙ the line may sit this far from the market price
  LINE_MIN: 0.05,
  LINE_MAX: 0.95,
  HOUSE_FOUNDING: 0,
  // Under this fortune the per-stake floor of 1 is dropped, so five stakes can
  // never sum to the whole fortune. This is what makes "never reaches zero" true.
  FLOOR_FROM: 10,
} as const;

export type Outcome = "yes" | "no" | "void";

function assertOnGrid(confidence: number): void {
  const ok =
    Number.isInteger(confidence) &&
    confidence >= C.CONFIDENCE_MIN &&
    confidence <= C.CONFIDENCE_MAX &&
    (confidence - C.CONFIDENCE_MIN) % C.CONFIDENCE_STEP === 0;
  if (!ok) throw new Error(`fortune: confidence ${confidence} is off the grid`);
}

/** ((c − 50) / 50) × STAKE_FRACTION_MAX, doubled for the Big One. */
export function stakeFraction(confidence: number, isBigOne: boolean): number {
  assertOnGrid(confidence);
  return ((confidence - 50) / 50) * FORTUNE.STAKE_FRACTION_MAX * (isBigOne ? 2 : 1);
}

/** The stake frozen at seal. Floor 1 from FLOOR_FROM upward; below, a zero stake is a valid unpaid call. */
export function stake(fortune: number, confidence: number, isBigOne: boolean): number {
  const raw = Math.round(fortune * stakeFraction(confidence, isBigOne));
  if (fortune >= FORTUNE.FLOOR_FROM) return Math.max(1, raw);
  return Math.max(0, raw);
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

/** The card's readout: this stake, and what a right call pays on top of it. */
export function stakePreview(input: { fortune: number; confidence: number; isBigOne: boolean; line: number; answer: boolean }): { stake: number; pays: number } {
  const s = stake(input.fortune, input.confidence, input.isBigOne);
  return { stake: s, pays: Math.round(s * odds(input.answer, input.line)) };
}

// The ladder the app offers (design §4.2, D13): five of the nine grid values,
// staking 1, 3, 5, 7 and 9 percent. The core and the API still accept the
// whole grid; only the offer narrows, so an older round or a later client can
// use any value on it.
export const LADDER_CONFIDENCES = [55, 65, 75, 85, 95] as const;
export const LADDER_DEFAULT = 75;

export type LadderRung = { confidence: number; stake: number; wins: number };

/** Every rung priced at the line for the chosen side: the stake, and what a right call wins on top of it. */
export function stakeLadder(input: { fortune: number; isBigOne: boolean; line: number; answer: boolean }): LadderRung[] {
  return LADDER_CONFIDENCES.map((confidence) => {
    const p = stakePreview({ ...input, confidence });
    return { confidence, stake: p.stake, wins: p.pays };
  });
}
