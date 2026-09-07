import type { ConfidenceBucket, ConfidenceHistory } from "@oracle/core";

export function confidenceHistoryView(history: ConfidenceHistory): {
  state: "empty" | "building" | "ready";
  selected: ConfidenceBucket | null;
} {
  // Count alone chooses the headline; accuracy never influences selection.
  const selected = history.buckets.reduce<ConfidenceBucket | null>((best, bucket) => {
    if (bucket.total === 0) return best;
    return !best || bucket.total > best.total ||
      (bucket.total === best.total && bucket.confidence < best.confidence) ? bucket : best;
  }, null);
  return {
    state: !selected ? "empty" : selected.total >= history.min_bucket_calls ? "ready" : "building",
    selected,
  };
}
