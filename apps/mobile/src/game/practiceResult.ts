import { payoff } from "@oracle/core";

export type PracticePrediction = { answer: boolean; confidence: number };

// One fixed fictional home win makes retries comparable. No crowd or Big One.
export function practiceResult(prediction: PracticePrediction) {
  const points = payoff(prediction.confidence, false);
  return {
    correct: prediction.answer,
    points: prediction.answer ? points.win : points.loss,
    oppositePoints: prediction.answer ? points.loss : points.win,
  };
}
