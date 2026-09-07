import { describe, expect, it } from "vitest";
import type { ConfidenceBucket, ConfidenceHistory } from "@oracle/core";
import { confidenceHistoryView } from "../src/game/confidenceHistoryView";

const history = (buckets: ConfidenceBucket[]): ConfidenceHistory => ({
  scope: "lifetime_resolved", min_bucket_calls: 20, buckets,
});
const bucket = (confidence: number, total: number, correct = 0): ConfidenceBucket => ({ confidence, total, correct });

describe("confidenceHistoryView", () => {
  it("starts empty", () => {
    expect(confidenceHistoryView(history([]))).toEqual({ state: "empty", selected: null });
  });
  it.each([[19, "building"], [20, "ready"]] as const)("uses the threshold at %i calls", (total, state) => {
    const selected = bucket(80, total, 12);
    expect(confidenceHistoryView(history([selected]))).toEqual({ state, selected });
  });
  it("keeps fifty scattered calls building", () => {
    const buckets = [bucket(55, 10), bucket(65, 10), bucket(75, 10), bucket(85, 10), bucket(95, 10)];
    expect(confidenceHistoryView(history(buckets))).toEqual({ state: "building", selected: buckets[0] });
  });
  it("breaks ties by lower confidence, independent of accuracy or input order", () => {
    const lower = bucket(80, 20, 20);
    expect(confidenceHistoryView(history([bucket(85, 20, 0), lower])).selected).toEqual(lower);
  });
  it("chooses the most used level and preserves exact counts", () => {
    const selected = bucket(80, 40, 29);
    expect(confidenceHistoryView(history([bucket(55, 20, 0), selected, bucket(95, 30, 30)])))
      .toEqual({ state: "ready", selected });
  });
  it("returns to building when a correction removes the twentieth call", () => {
    expect(confidenceHistoryView(history([bucket(80, 20, 15)])).state).toBe("ready");
    expect(confidenceHistoryView(history([bucket(80, 19, 14)])).state).toBe("building");
  });
});
