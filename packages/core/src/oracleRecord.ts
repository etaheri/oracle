import { CONSTANTS as C } from "./constants";

// THE ORACLE's own record. It forecasts every question before the round
// opens, crowd-blind, and is read on the same rule as the players -- with
// one asymmetry, stated here because it is the whole ethic of the thing:
// the machine keeps what a CALL earns (the affine-Brier term and the big
// one's double weight) and nothing that TIMING, a CROWD, or a PURCHASE
// confers (the first hour, the contrarian bounty, the vigil multiplier).

export type OracleSide = "yes" | "no" | null;

/**
 * Exactly 0.5 is an ABSTENTION, not a coin flip. The machine is allowed to
 * decline, and a forced call would be right half the time by construction --
 * counting it would flatter the Oracle's record for free.
 */
export function oracleCall(pYes: number | null): OracleSide {
  if (pYes === null) return null;
  if (pYes > 0.5) return "yes";
  if (pYes < 0.5) return "no";
  return null;
}

/** null means "not counted": no forecast, an abstention, a void, or unresolved. */
export function oracleCallRight(
  pYes: number | null,
  outcome: "yes" | "no" | "void" | null,
): boolean | null {
  if (outcome === null || outcome === "void") return null;
  const call = oracleCall(pYes);
  if (call === null) return null;
  return call === outcome;
}

export function oracleBrierOf(pYes: number, outcome: "yes" | "no"): number {
  return (pYes - (outcome === "yes" ? 1 : 0)) ** 2;
}

/**
 * The Oracle's points on one question. Deliberately takes NO crowd argument:
 * there is no input by which the contrarian bounty could reach it.
 */
export function oracleQuestionPoints(input: {
  pYes: number;
  outcome: "yes" | "no" | "void";
  isBigOne: boolean;
}): number {
  if (input.outcome === "void") return 0;
  const b = oracleBrierOf(input.pYes, input.outcome);
  const base = C.POINTS_SCALE * (C.POINTS_BASELINE - b);
  const result = (input.isBigOne ? C.BIG_ONE_MULT : 1) * base;
  // Same two-stage rounding questionPoints uses: kill float noise, then int.
  return Math.round(Math.round(result * 1e10) / 1e10);
}

/**
 * The reveal's closing line: how many calls each of you got right today.
 * Reported as two bare counts with no denominator, because the denominators
 * genuinely differ -- the Oracle may abstain and the player may not have
 * sealed -- and a shared denominator would be a lie about one of them.
 */
export function dayCallCounts(
  questions: Array<{
    outcome: "yes" | "no" | "void" | null;
    oracle_p_yes: number | null;
    my: { answer: boolean } | null;
  }>,
): { you: number; oracle: number } {
  let you = 0;
  let oracle = 0;
  for (const q of questions) {
    if (q.outcome === null || q.outcome === "void") continue;
    if (q.my && (q.my.answer ? "yes" : "no") === q.outcome) you += 1;
    if (oracleCallRight(q.oracle_p_yes, q.outcome) === true) oracle += 1;
  }
  return { you, oracle };
}
