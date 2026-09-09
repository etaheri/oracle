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
    // Sentence case: this is the one line under the headline that explains why
    // the day scored the way it did, it is rendered in the reading register,
    // and it was the only copy on the reveal still shouting through it.
    // practiceResult.ts already writes its own explanation this way.
    explanation: duel.status === "complete" ? "Base points decide the duel. Crowd bonuses and streaks do not count." : duel.status === "unavailable" ? "No complete Oracle forecast. Your record still counts." : duel.status === "incomplete" ? "An incomplete round has no duel." : duel.status === "insufficient" ? "Too few scored questions for a duel." : "Unread questions are not losses.",
    canShareFinal: !pending && scored.length > 0,
    rivalry: rivalryMoment(qs, duel),
  };
}
