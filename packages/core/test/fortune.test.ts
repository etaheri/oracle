import { describe, it, expect } from "vitest";
import { FORTUNE, stake, doubledStake, busts, odds, payout, delta, clampLine, dayReturn, sidePreview } from "../src/fortune";
import { CONSTANTS } from "../src/constants";

describe("the flat stake (spec §4.1, H3)", () => {
  it("is five percent of the fortune, ten on the Big One", () => {
    expect(FORTUNE.STAKE_FRACTION).toBe(0.05);
    expect(stake(1000, false)).toBe(50);
    expect(stake(1000, true)).toBe(100);
    expect(stake(1500, false)).toBe(75);
  });
  it("rounds, and floors at one always", () => {
    expect(stake(10, false)).toBe(1);   // round(0.5) = 1
    expect(stake(7, false)).toBe(1);    // round(0.35) = 0 → floor 1
    expect(stake(1, true)).toBe(1);
  });
});

describe("the double (spec §4.2, H4)", () => {
  it("doubles the frozen stake", () => {
    expect(FORTUNE.DOUBLE_MULT).toBe(2);
    expect(doubledStake(50)).toBe(100);
    expect(doubledStake(100)).toBe(200);
  });
  it("a round of five all wrong costs 30 percent, or 40 with the double on the Big One", () => {
    const f = 1000;
    const plain = stake(f, false) * 4 + stake(f, true);
    expect(plain).toBe(300);
    expect(stake(f, false) * 4 + doubledStake(stake(f, true))).toBe(400);
  });
});

describe("the bust (spec §4.4, H5)", () => {
  it("is a fortune under 100 at settlement", () => {
    expect(FORTUNE.BUST_UNDER).toBe(100);
    expect(busts(99)).toBe(true);
    expect(busts(100)).toBe(false);
    expect(busts(0)).toBe(true);
    expect(busts(-40)).toBe(true);
  });
});

describe("the constant confidence (spec H8)", () => {
  it("is on the 55-95 step-5 grid so every Brier and points reader keeps computing", () => {
    const c = FORTUNE.CONFIDENCE_FLAT;
    expect(c).toBe(75);
    expect(c).toBeGreaterThanOrEqual(CONSTANTS.CONFIDENCE_MIN);
    expect(c).toBeLessThanOrEqual(CONSTANTS.CONFIDENCE_MAX);
    expect((c - CONSTANTS.CONFIDENCE_MIN) % CONSTANTS.CONFIDENCE_STEP).toBe(0);
  });
});

describe("odds", () => {
  it("YES pays (1 − line)/line, NO pays line/(1 − line)", () => {
    expect(odds(true, 0.35)).toBeCloseTo(0.65 / 0.35, 10);
    expect(odds(false, 0.35)).toBeCloseTo(0.35 / 0.65, 10);
    expect(odds(true, 0.5)).toBeCloseTo(1, 10);
  });
});

describe("payout and delta", () => {
  const yesAt35 = { stake: 100, answer: true, line: 0.35 };
  it("right call returns stake plus stake × odds, rounded", () => {
    expect(payout({ ...yesAt35, outcome: "yes" })).toBe(286); // 100 + round(185.71)
    expect(delta({ ...yesAt35, outcome: "yes" })).toBe(186);
  });
  it("wrong call loses the stake", () => {
    expect(payout({ ...yesAt35, outcome: "no" })).toBe(0);
    expect(delta({ ...yesAt35, outcome: "no" })).toBe(-100);
  });
  it("void returns the stake", () => {
    expect(payout({ ...yesAt35, outcome: "void" })).toBe(100);
    expect(delta({ ...yesAt35, outcome: "void" })).toBe(0);
  });
  it("NO at the same line pays less", () => {
    expect(payout({ stake: 100, answer: false, line: 0.35, outcome: "no" })).toBe(154); // 100 + round(53.85)
  });
  it("at the clamp bounds the largest multiple is 19", () => {
    expect(delta({ stake: 100, answer: true, line: 0.05, outcome: "yes" })).toBe(1900);
    expect(delta({ stake: 100, answer: false, line: 0.95, outcome: "no" })).toBe(1900);
  });
});

describe("clampLine", () => {
  it("keeps a line inside the market band", () => {
    expect(clampLine(0.40, 0.35)).toBeCloseTo(0.40, 10);
    expect(clampLine(0.10, 0.35)).toBeCloseTo(0.20, 10); // band floor 0.35 − 0.15
    expect(clampLine(0.70, 0.35)).toBeCloseTo(0.50, 10); // band ceiling
  });
  it("never leaves [LINE_MIN, LINE_MAX] even when the band would", () => {
    expect(clampLine(0.01, 0.10)).toBeCloseTo(FORTUNE.LINE_MIN, 10);
    expect(clampLine(0.99, 0.90)).toBeCloseTo(FORTUNE.LINE_MAX, 10);
  });
  it("with no market price clamps to [LINE_MIN, LINE_MAX] only", () => {
    expect(clampLine(0.02, null)).toBeCloseTo(FORTUNE.LINE_MIN, 10);
    expect(clampLine(0.60, null)).toBeCloseTo(0.60, 10);
  });
});

describe("dayReturn", () => {
  it("is Σ delta over fortune at open", () => {
    expect(dayReturn([186, -100, 0], 1000)).toBeCloseTo(0.086, 10);
  });
  it("is 0 with no deltas and never divides by zero", () => {
    expect(dayReturn([], 1000)).toBe(0);
    expect(dayReturn([50], 0)).toBe(0);
  });
});

describe("sidePreview (spec §5.1)", () => {
  it("prices both sides at the flat stake", () => {
    expect(sidePreview({ fortune: 1000, isBigOne: false, line: 0.35, answer: true })).toEqual({ stake: 50, wins: 93 });   // round(50 × 1.857)
    expect(sidePreview({ fortune: 1000, isBigOne: false, line: 0.35, answer: false })).toEqual({ stake: 50, wins: 27 });  // round(50 × 0.538)
    expect(sidePreview({ fortune: 1000, isBigOne: true, line: 0.35, answer: true })).toEqual({ stake: 100, wins: 186 });
    expect(sidePreview({ fortune: 1000, isBigOne: true, line: 0.35, answer: false })).toEqual({ stake: 100, wins: 54 });
  });
});
