import { CONSTANTS as C } from "./constants";

export function brier(input: { answer: boolean; confidence: number; outcome: "yes" | "no" }): number {
  const pYes = input.answer ? input.confidence / 100 : 1 - input.confidence / 100;
  const outcome = input.outcome === "yes" ? 1 : 0;
  return (pYes - outcome) ** 2;
}

export function contrarianApplies(sidePct: number, crowdCount: number): boolean {
  return crowdCount >= C.CONTRARIAN_MIN_CROWD && sidePct < C.CONTRARIAN_CROWD_PCT;
}

export function questionPoints(input: {
  answer: boolean;
  confidence: number;
  outcome: "yes" | "no" | "void";
  isBigOne: boolean;
  crowdYesPct: number;
  crowdCount: number;
}): number {
  if (input.outcome === "void") return 0;
  const b = brier({ answer: input.answer, confidence: input.confidence, outcome: input.outcome });
  const base = C.POINTS_SCALE * (C.POINTS_BASELINE - b); // proper: affine in brier
  const bigMult = input.isBigOne ? C.BIG_ONE_MULT : 1;
  const sidePct = input.answer ? input.crowdYesPct : 100 - input.crowdYesPct;
  // Contrarian credit is ADDITIVE (a constant, never a multiplier on the
  // Brier term) so the expected-points maximizer stays the honest belief.
  const bonus = base > 0 && contrarianApplies(sidePct, input.crowdCount) ? C.CONTRARIAN_BONUS : 0;
  const result = bigMult * base + bigMult * bonus;
  // Round to high precision first to eliminate floating-point noise, then round to integer
  return Math.round(Math.round(result * 1e10) / 1e10);
}

// The card's honest payoff line: what this conviction earns if right / costs
// if wrong, before any crowd credit.
export function payoff(confidence: number, isBigOne: boolean): { win: number; loss: number } {
  const common = { answer: true, confidence, isBigOne, crowdYesPct: 50, crowdCount: 0 };
  return {
    win: questionPoints({ ...common, outcome: "yes" }),
    loss: questionPoints({ ...common, outcome: "no" }),
  };
}

export function dayPoints(perQuestion: number[], firstHour: boolean): number {
  const sum = perQuestion.reduce((a, b) => a + b, 0);
  if (!firstHour || sum <= 0) return sum;
  return sum + Math.round(C.FIRST_HOUR_BONUS * sum);
}

export function oracleScore(briers: number[]): number | null {
  if (briers.length < C.ORACLE_SCORE_MIN_CALLS) return null;
  const window = briers.slice(-C.ORACLE_SCORE_WINDOW);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const result = 1000 * (1 - mean);
  return Math.round(Math.round(result * 1e10) / 1e10);
}

/**
 * How heavily the ledger weighs a day, given the vigil carried into it.
 * 1.00 with no vigil, rising to 1.50 at VIGIL_MULT_MAX_DAYS and holding.
 */
export function vigilMultiplier(streak: number): number {
  const days = Math.min(Math.max(streak, 0), C.VIGIL_MULT_MAX_DAYS);
  return 1 + C.VIGIL_MULT_PER_DAY * days;
}

/**
 * The weighed day. Applied to the day's TOTAL, after the first-hour bonus,
 * and to negative totals exactly as to positive ones -- a long vigil
 * amplifies a bad day as much as a good one. That symmetry is what keeps the
 * rule proper (see vigilMultiplier's note in constants.ts); it is also the
 * stake that makes a vigil worth defending.
 */
export function vigilPoints(dayTotal: number, streak: number): number {
  return Math.round(dayTotal * vigilMultiplier(streak));
}
