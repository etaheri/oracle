import { describe, it, expect } from "vitest";
import { ExhibitionSchema, PRACTICE_FORTUNE, practiceLine, practiceOutcome } from "../src/exhibition";

const base = {
  id: "q1", kind: "historical" as const, question: "Will it rain?", context: "Clouds.",
  sourceName: "NWS", roundDate: "2026-09-01", oraclePYes: 0.7, outcome: "yes" as const,
};

describe("the practice line (spec §7, §8.3)", () => {
  it("parses an exhibition without a line, defaulting it to null", () => {
    expect(ExhibitionSchema.parse(base).linePYes).toBeNull();
  });

  it("uses the served line when there is one", () => {
    expect(practiceLine(ExhibitionSchema.parse({ ...base, linePYes: 0.42 }))).toBe(0.42);
  });

  it("falls back to the Oracle's forecast clamped to the line bounds", () => {
    expect(practiceLine(ExhibitionSchema.parse(base))).toBe(0.7);
    expect(practiceLine(ExhibitionSchema.parse({ ...base, oraclePYes: 0.01 }))).toBe(0.05);
    expect(practiceLine(ExhibitionSchema.parse({ ...base, oraclePYes: 0.99 }))).toBe(0.95);
  });
});

describe("the practice outcome runs on the practice fortune", () => {
  it("starts every practice at 1,000", () => {
    expect(PRACTICE_FORTUNE).toBe(1000);
  });

  it("pays a right call at the line's odds and never touches a real fortune", () => {
    const ex = ExhibitionSchema.parse({ ...base, linePYes: 0.7 });
    const out = practiceOutcome({ answer: true, confidence: 75 }, ex);
    expect(out.line).toBe(0.7);
    expect(out.stake).toBe(50);
    expect(out.wins).toBe(21); // round(50 × 0.3 / 0.7)
    expect(out.payout).toBe(71);
    expect(out.delta).toBe(21);
    expect(out.correct).toBe(true);
    // Had the outcome gone the other way, the same call loses the stake.
    expect(out.oppositeDelta).toBe(-50);
  });

  it("loses the stake on a wrong call", () => {
    const ex = ExhibitionSchema.parse({ ...base, linePYes: 0.7 });
    const out = practiceOutcome({ answer: false, confidence: 95 }, ex);
    expect(out.stake).toBe(90);
    expect(out.payout).toBe(0);
    expect(out.delta).toBe(-90);
    expect(out.correct).toBe(false);
    expect(out.oppositeDelta).toBe(210); // round(90 × 0.7 / 0.3)
  });

  it("rejects an off-grid confidence", () => {
    expect(() => practiceOutcome({ answer: true, confidence: 72 }, ExhibitionSchema.parse(base))).toThrow();
  });
});
