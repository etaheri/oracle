import { describe, it, expect } from "vitest";
import { PredictionSubmitSchema } from "../src/schemas";

const valid = {
  question_id: "3f0d8c1e-2b4a-4c6d-9e8f-1a2b3c4d5e6f",
  answer: true,
  confidence: 75,
  idempotency_key: "abc-123",
};

describe("PredictionSubmitSchema", () => {
  it("accepts a valid submission", () => {
    expect(PredictionSubmitSchema.parse(valid)).toEqual(valid);
  });
  it("rejects confidence off the 55-95 step-5 grid", () => {
    for (const confidence of [50, 54, 96, 100, 72]) {
      expect(PredictionSubmitSchema.safeParse({ ...valid, confidence }).success).toBe(false);
    }
  });
  it("accepts every legal confidence value", () => {
    for (let confidence = 55; confidence <= 95; confidence += 5) {
      expect(PredictionSubmitSchema.safeParse({ ...valid, confidence }).success).toBe(true);
    }
  });
  it("rejects a non-uuid question_id", () => {
    expect(PredictionSubmitSchema.safeParse({ ...valid, question_id: "nope" }).success).toBe(false);
  });
});
