import { oracleQuestionPoints, type DuelQuestion, type DuelResult } from "@oracle/core";
import { rivalryMoment } from "./rivalryMoment";
export function revealSummary(qs: DuelQuestion[], duel: DuelResult) {
  const scored = qs.filter(q => q.my && (q.outcome === "yes" || q.outcome === "no"));
  const pending = qs.some(q => q.outcome === null);
  const right = scored.filter(q => (q.my!.answer ? "yes" : "no") === q.outcome).length;
  const fallback = [...scored].sort((a, b) => {
    const points = (q: DuelQuestion) => Math.abs(oracleQuestionPoints({ pYes: q.my!.answer ? q.my!.confidence / 100 : 1 - q.my!.confidence / 100, outcome: q.outcome!, isBigOne: q.is_big_one }));
    return points(b) - points(a) || a.slot - b.slot;
  })[0];
  return {
    headline: pending ? "THE ROUND IS STILL BEING READ" : duel.status === "complete" ? ({ you: "YOU OUTSAW THE ORACLE", oracle: "THE ORACLE SAW FURTHER", tie: "YOU AND THE ORACLE STAND LEVEL" }[duel.winner]) : `${right} RIGHT · ${scored.length} CALLS READ`,
    highlightId: pending ? null : duel.status === "complete" ? duel.highlightId : fallback?.id ?? null,
    explanation: duel.status === "complete" ? "BASE POINTS DECIDE THE DUEL. CROWD BONUSES AND STREAKS DO NOT COUNT." : duel.status === "unavailable" ? "NO COMPLETE ORACLE FORECAST. YOUR RECORD STILL COUNTS." : duel.status === "incomplete" ? "AN INCOMPLETE ROUND HAS NO DUEL." : duel.status === "insufficient" ? "TOO FEW SCORED QUESTIONS FOR A DUEL." : "UNREAD QUESTIONS ARE NOT LOSSES.",
    canShareFinal: !pending && scored.length > 0,
    rivalry: rivalryMoment(qs, duel),
  };
}
