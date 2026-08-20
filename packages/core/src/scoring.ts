import { CONSTANTS as C } from "./constants";

export function brier(input: { answer: boolean; confidence: number; outcome: "yes" | "no" }): number {
  const pYes = input.answer ? input.confidence / 100 : 1 - input.confidence / 100;
  const outcome = input.outcome === "yes" ? 1 : 0;
  return (pYes - outcome) ** 2;
}

export function questionPoints(input: {
  answer: boolean;
  confidence: number;
  outcome: "yes" | "no" | "void";
  isBigOne: boolean;
  crowdYesPct: number;
}): number {
  if (input.outcome === "void") return 0;
  const b = brier({ answer: input.answer, confidence: input.confidence, outcome: input.outcome });
  const base = C.POINTS_SCALE * (C.POINTS_BASELINE - b); // proper: affine in brier
  const win = base > 0;
  const sidePct = input.answer ? input.crowdYesPct : 100 - input.crowdYesPct;
  const contrarian = win && sidePct < C.CONTRARIAN_CROWD_PCT;
  const mult = (input.isBigOne ? C.BIG_ONE_MULT : 1) * (contrarian ? C.CONTRARIAN_MULT : 1);
  const result = mult * base;
  // Round to high precision first to eliminate floating-point noise, then round to integer
  return Math.round(Math.round(result * 1e10) / 1e10);
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
