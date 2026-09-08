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
  return {
    ...comparison,
    correct: prediction.answer === (exhibition.outcome === "yes"),
    oppositePoints: opposite.youPoints,
    oracleAnswer,
    oracleConfidence,
    oracleAbstained: oracleAnswer === null,
    sameAnswer: oracleAnswer !== null && prediction.answer === oracleAnswer,
  };
}
