import { oracleQuestionPoints, type DuelQuestion, type DuelResult } from "@oracle/core";

/** Explain the scoring rule without conflating base points and stored bonuses. */
export function revealLearning(q: DuelQuestion, rulesVersion: number, duel: DuelResult) {
  if (!q.my || q.outcome === null || q.outcome === "void") return null;
  const playerBasePoints = oracleQuestionPoints({
    pYes: q.my.answer ? q.my.confidence / 100 : 1 - q.my.confidence / 100,
    outcome: q.outcome, isBigOne: q.is_big_one,
  });
  const comparable = rulesVersion >= 2 && duel.status === "complete" && q.oracle_p_yes !== null && Number.isFinite(q.oracle_p_yes) && q.oracle_p_yes >= 0 && q.oracle_p_yes <= 1;
  const oracleBasePoints = comparable ? oracleQuestionPoints({ pYes: q.oracle_p_yes!, outcome: q.outcome, isBigOne: q.is_big_one }) : null;
  return { playerBasePoints, oracleBasePoints, gap: oracleBasePoints === null ? null : playerBasePoints - oracleBasePoints, doubleWeight: q.is_big_one };
}
