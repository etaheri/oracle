import { describe, it, expect } from "vitest";
import { brier, questionPoints } from "../src/scoring";

describe("brier", () => {
  it("is (p_yes - outcome)^2 for a YES answer", () => {
    // answer YES @ 75 → p_yes = 0.75; outcome yes → (0.75-1)^2 = 0.0625
    expect(brier({ answer: true, confidence: 75, outcome: "yes" })).toBeCloseTo(0.0625, 10);
  });
  it("maps a NO answer to p_yes = 1 - confidence", () => {
    // answer NO @ 95 → p_yes = 0.05; outcome yes → (0.05-1)^2 = 0.9025 (worst case)
    expect(brier({ answer: false, confidence: 95, outcome: "yes" })).toBeCloseTo(0.9025, 10);
  });
  it("best case: right at 95 → 0.0025", () => {
    expect(brier({ answer: true, confidence: 95, outcome: "yes" })).toBeCloseTo(0.0025, 10);
  });
});

describe("questionPoints", () => {
  const base = { isBigOne: false, crowdYesPct: 50 };
  // points = Math.round(mult × 200 × (0.25 − brier)) — proper affine Brier transform.
  // Win ladder (55..95): 10, 26, 38, 46, 50. Loss ladder: −10, −34, −62, −94, −130.
  it("correct: round(200×(0.25−brier))", () => {
    expect(questionPoints({ ...base, answer: true, confidence: 55, outcome: "yes" })).toBe(10);  // b=0.2025 → 9.5 → 10
    expect(questionPoints({ ...base, answer: true, confidence: 75, outcome: "yes" })).toBe(38);  // b=0.0625 → 37.5 → 38
    expect(questionPoints({ ...base, answer: true, confidence: 95, outcome: "yes" })).toBe(50);  // b=0.0025 → 49.5 → 50
  });
  it("wrong: same formula, brier > 0.25 goes negative", () => {
    expect(questionPoints({ ...base, answer: true, confidence: 55, outcome: "no" })).toBe(-10);  // b=0.3025 → −10.5 → −10
    expect(questionPoints({ ...base, answer: true, confidence: 75, outcome: "no" })).toBe(-62);  // b=0.5625 → −62.5 → −62
    expect(questionPoints({ ...base, answer: true, confidence: 95, outcome: "no" })).toBe(-130); // b=0.9025 → −130.5 → −130
  });
  it("void: always 0", () => {
    expect(questionPoints({ ...base, answer: true, confidence: 95, outcome: "void" })).toBe(0);
  });
  it("big one doubles wins and losses (multiplied before the single rounding)", () => {
    expect(questionPoints({ ...base, isBigOne: true, answer: true, confidence: 75, outcome: "yes" })).toBe(75);   // 2×37.5 = 75
    expect(questionPoints({ ...base, isBigOne: true, answer: true, confidence: 75, outcome: "no" })).toBe(-125);  // 2×−62.5 = −125
  });
  it("contrarian ×2 on wins when your side's crowd % < 40", () => {
    // answered YES, crowd was 39% YES → contrarian win: 2×37.5 = 75
    expect(questionPoints({ isBigOne: false, crowdYesPct: 39, answer: true, confidence: 75, outcome: "yes" })).toBe(75);
    // exactly 40 is NOT contrarian
    expect(questionPoints({ isBigOne: false, crowdYesPct: 40, answer: true, confidence: 75, outcome: "yes" })).toBe(38);
    // NO answer: side pct = 100 − crowdYesPct → 61% YES means 39% NO side
    expect(questionPoints({ isBigOne: false, crowdYesPct: 61, answer: false, confidence: 75, outcome: "no" })).toBe(75);
  });
  it("contrarian never amplifies losses", () => {
    expect(questionPoints({ isBigOne: false, crowdYesPct: 39, answer: true, confidence: 75, outcome: "no" })).toBe(-62);
  });
  it("big one + contrarian stack: ×4 on a win", () => {
    expect(questionPoints({ isBigOne: true, crowdYesPct: 39, answer: true, confidence: 75, outcome: "yes" })).toBe(150); // 4×37.5
  });
});
