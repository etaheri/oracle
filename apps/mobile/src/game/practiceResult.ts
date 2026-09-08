import { compareExhibition, type Exhibition } from "@oracle/core";

export type PracticePrediction = { answer: boolean; confidence: number };

export function practiceResult(prediction: PracticePrediction, exhibition: Exhibition) {
  const comparison = compareExhibition(prediction, exhibition);
  const opposite = compareExhibition(prediction, {
    ...exhibition,
    outcome: exhibition.outcome === "yes" ? "no" : "yes",
  });
  const oracleAnswer = exhibition.oraclePYes === 0.5 ? null : exhibition.oraclePYes > 0.5;
  const oracleConfidence = oracleAnswer === null
    ? null
    : Math.round((oracleAnswer ? exhibition.oraclePYes : 1 - exhibition.oraclePYes) * 100);
  const correct = prediction.answer === (exhibition.outcome === "yes");
  const sameAnswer = oracleAnswer !== null && prediction.answer === oracleAnswer;
  const explanation = comparison.winner === "tie"
    ? "Equal points on this call."
    : oracleAnswer === null
      ? "The Oracle stayed at 50%. You took a side."
      : sameAnswer
        ? correct
          ? comparison.winner === "you" ? "You were both right. Your higher confidence earned more." : "You were both right. The Oracle's higher confidence earned more."
          : comparison.winner === "you" ? "You were both wrong. Your lower confidence cost less." : "You were both wrong. Your higher confidence cost more."
        : `You chose ${prediction.answer ? "YES" : "NO"}. The Oracle chose ${oracleAnswer ? "YES" : "NO"}. The outcome was ${exhibition.outcome.toUpperCase()}.`;
  return {
    ...comparison,
    correct,
    oppositePoints: opposite.youPoints,
    oracleAnswer,
    oracleConfidence,
    oracleAbstained: oracleAnswer === null,
    sameAnswer,
    explanation,
  };
}
