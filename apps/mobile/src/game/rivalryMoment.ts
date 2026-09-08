import { oracleCall, oracleQuestionPoints, type DuelQuestion, type DuelResult } from "@oracle/core";

export type RivalryMoment = {
  questionId: string;
  kind: "opposite_calls" | "confidence" | "abstention";
  line: string;
};

export function rivalryMoment(questions: DuelQuestion[], duel: DuelResult): RivalryMoment | null {
  if (duel.status !== "complete") return null;
  const question = questions.find((q) => q.id === duel.highlightId);
  if (!question?.my || (question.outcome !== "yes" && question.outcome !== "no") || question.oracle_p_yes === null) return null;

  const playerProbability = question.my.answer ? question.my.confidence / 100 : 1 - question.my.confidence / 100;
  const playerPoints = oracleQuestionPoints({ pYes: playerProbability, outcome: question.outcome, isBigOne: question.is_big_one });
  const oraclePoints = oracleQuestionPoints({ pYes: question.oracle_p_yes, outcome: question.outcome, isBigOne: question.is_big_one });
  if (playerPoints === oraclePoints) return null;

  const playerCall = question.my.answer ? "yes" : "no";
  const machineCall = oracleCall(question.oracle_p_yes);
  if (machineCall === null) {
    return { questionId: question.id, kind: "abstention", line: "The Oracle stayed at 50%. You took a side." };
  }
  if (playerCall !== machineCall) {
    const playerWasRight = playerCall === question.outcome;
    return {
      questionId: question.id,
      kind: "opposite_calls",
      line: playerWasRight
        ? "You saw what the Oracle missed on this call."
        : "The Oracle saw what you missed on this call.",
    };
  }
  const higherConfidence = playerProbability > 0.5
    ? playerProbability > question.oracle_p_yes
    : playerProbability < question.oracle_p_yes;
  const right = playerCall === question.outcome;
  const line = right
    ? higherConfidence ? "You were both right. Your higher confidence earned more." : "You were both right. The Oracle's higher confidence earned more."
    : higherConfidence ? "You were both wrong. Your higher confidence cost more." : "You were both wrong. Your lower confidence cost less.";
  return { questionId: question.id, kind: "confidence", line };
}
