import { oracleQuestionPoints, oracleCallRight } from "./oracleRecord";
import { ratingEligible } from "./roundRules";
export type DuelQuestion = {
  id: string; slot: number; is_big_one: boolean;
  outcome: "yes" | "no" | "void" | null; oracle_p_yes: number | null;
  my: { answer: boolean; confidence: number } | null;
};
export type DuelResult =
  | { status: "pending" | "incomplete" | "insufficient" | "unavailable" }
  | { status: "complete"; youPoints: number; oraclePoints: number; winner: "you" | "oracle" | "tie"; scoredCount: number; youCorrect: number; oracleCorrect: number; oracleAbstained: number; highlightId: string };

export function calculateDuel(qs: DuelQuestion[], version = 1): DuelResult {
  if (qs.some(q => q.outcome === null)) return { status: "pending" };
  const scored = qs.filter(q => q.outcome === "yes" || q.outcome === "no").sort((a, b) => a.slot - b.slot);
  if (scored.length < 3) return { status: "insufficient" };
  if (!ratingEligible(version, qs, new Set(qs.filter(q => q.my).map(q => q.id)))) return { status: "incomplete" };
  if (scored.some(q => q.oracle_p_yes === null || !Number.isFinite(q.oracle_p_yes) || q.oracle_p_yes < 0 || q.oracle_p_yes > 1)) return { status: "unavailable" };
  let youPoints = 0, oraclePoints = 0, youCorrect = 0, oracleCorrect = 0, oracleAbstained = 0;
  let gap = -1, highlightId = scored[0]!.id;
  for (const q of scored) {
    const outcome = q.outcome as "yes" | "no";
    const my = q.my!;
    const yours = oracleQuestionPoints({ pYes: my.answer ? my.confidence / 100 : 1 - my.confidence / 100, outcome, isBigOne: q.is_big_one });
    const theirs = oracleQuestionPoints({ pYes: q.oracle_p_yes!, outcome, isBigOne: q.is_big_one });
    youPoints += yours; oraclePoints += theirs;
    if ((my.answer ? "yes" : "no") === outcome) youCorrect++;
    if (oracleCallRight(q.oracle_p_yes, outcome)) oracleCorrect++;
    if (q.oracle_p_yes === .5) oracleAbstained++;
    if (Math.abs(yours - theirs) > gap) { gap = Math.abs(yours - theirs); highlightId = q.id; }
  }
  return { status: "complete", youPoints, oraclePoints, winner: youPoints > oraclePoints ? "you" : youPoints < oraclePoints ? "oracle" : "tie", scoredCount: scored.length, youCorrect, oracleCorrect, oracleAbstained, highlightId };
}

export function duelLine(d: DuelResult): string | null {
  if (d.status !== "complete") return null;
  return `YOU ${d.youPoints} · THE ORACLE ${d.oraclePoints} · BASE POINTS`;
}
