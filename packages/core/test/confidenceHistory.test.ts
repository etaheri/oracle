import { describe, expect, it } from "vitest";
import { confidenceHistory, MeLedgerSchema } from "../src/index";

describe("confidence history", () => {
  it("counts exact confidence levels over the whole supplied history", () => {
    expect(confidenceHistory(Array.from({ length: 40 }, (_, i) => ({ confidence: 80, correct: i < 29 })))).toEqual({
      scope: "lifetime_resolved", min_bucket_calls: 20,
      buckets: [{ confidence: 80, total: 40, correct: 29 }],
    });
    expect(confidenceHistory(Array.from({ length: 120 }, () => ({ confidence: 55, correct: true }))).buckets[0]?.total).toBe(120);
  });
  it("sorts distinct levels and ignores invalid confidence", () => {
    expect(confidenceHistory([
      { confidence: 80, correct: false }, { confidence: 75, correct: true },
      { confidence: 80, correct: true }, { confidence: 95, correct: false },
      ...[50, 100, NaN, 82, Infinity].map(confidence => ({ confidence, correct: true })),
    ]).buckets).toEqual([
      { confidence: 75, total: 1, correct: 1 }, { confidence: 80, total: 2, correct: 1 },
      { confidence: 95, total: 1, correct: 0 },
    ]);
    expect(confidenceHistory([]).buckets).toEqual([]);
  });
  const schema = MeLedgerSchema.pick({ confidence_history: true });
  it("preserves absence for older APIs and accepts valid history", () => {
    expect(schema.parse({})).toEqual({});
    expect(schema.safeParse({ confidence_history: confidenceHistory([]) }).success).toBe(true);
  });
  it.each([
    { scope: "recent" }, { min_bucket_calls: 19 },
    { buckets: [{ confidence: 82, total: 1, correct: 1 }] },
    { buckets: [{ confidence: 80, total: 0, correct: 0 }] },
    { buckets: [{ confidence: 80, total: 1.5, correct: 1 }] },
    { buckets: [{ confidence: 80, total: 1, correct: -1 }] },
    { buckets: [{ confidence: 80, total: 1, correct: 2 }] },
    { buckets: [{ confidence: 80, total: 1, correct: 0.5 }] },
    { buckets: [{ confidence: 80, total: 1, correct: 1 }, { confidence: 75, total: 1, correct: 1 }] },
    { buckets: [{ confidence: 80, total: 1, correct: 1 }, { confidence: 80, total: 1, correct: 1 }] },
  ])("rejects malformed history %j", override => {
    expect(schema.safeParse({ confidence_history: { ...confidenceHistory([]), ...override } }).success).toBe(false);
  });
});
