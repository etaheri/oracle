import { CONSTANTS } from "./constants";

export type ConfidenceCall = { confidence: number; correct: boolean };
export type ConfidenceBucket = { confidence: number; total: number; correct: number };
export type ConfidenceHistory = {
  scope: "lifetime_resolved";
  min_bucket_calls: number;
  buckets: ConfidenceBucket[];
};

/** Descriptive lifetime counts; each resolved call has equal weight. */
export function confidenceHistory(calls: readonly ConfidenceCall[]): ConfidenceHistory {
  const buckets = new Map<number, ConfidenceBucket>();
  for (const call of calls) {
    const { confidence } = call;
    if (!Number.isInteger(confidence) || confidence < CONSTANTS.CONFIDENCE_MIN ||
      confidence > CONSTANTS.CONFIDENCE_MAX ||
      (confidence - CONSTANTS.CONFIDENCE_MIN) % CONSTANTS.CONFIDENCE_STEP !== 0) continue;
    const bucket = buckets.get(confidence) ?? { confidence, total: 0, correct: 0 };
    bucket.total++;
    if (call.correct) bucket.correct++;
    buckets.set(confidence, bucket);
  }
  return { scope: "lifetime_resolved", min_bucket_calls: 20,
    buckets: [...buckets.values()].sort((a, b) => a.confidence - b.confidence) };
}
