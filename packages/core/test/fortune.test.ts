import { describe, it, expect } from "vitest";
import {
  FORTUNE, stakeFraction, stake, odds, payout, delta, clampLine, dayReturn, stakePreview,
} from "../src/fortune";

describe("stakeFraction", () => {
  // ((c − 50) / 50) × 0.10 → 55: 0.01, 75: 0.05, 95: 0.09; Big One doubles.
  it("runs 1% to 9% across the grid", () => {
    expect(stakeFraction(55, false)).toBeCloseTo(0.01, 10);
    expect(stakeFraction(75, false)).toBeCloseTo(0.05, 10);
    expect(stakeFraction(95, false)).toBeCloseTo(0.09, 10);
  });
  it("doubles for the Big One", () => {
    expect(stakeFraction(95, true)).toBeCloseTo(0.18, 10);
  });
  it("throws off-grid", () => {
    expect(() => stakeFraction(50, false)).toThrow();
    expect(() => stakeFraction(96, false)).toThrow();
    expect(() => stakeFraction(72, false)).toThrow();
  });
});

describe("stake", () => {
  it("is fortune × fraction, rounded, floor 1 from a fortune of 10", () => {
    expect(stake(1000, 55, false)).toBe(10);
    expect(stake(1000, 95, false)).toBe(90);
    expect(stake(1000, 95, true)).toBe(180);
    expect(stake(10, 55, false)).toBe(1);  // round(0.1) = 0 → floor 1
  });
  it("stakes zero rather than the floor when the fortune is under 10", () => {
    expect(stake(7, 55, false)).toBe(0);
    expect(stake(9, 95, true)).toBe(2);    // round(1.62)
    expect(stake(1, 95, true)).toBe(0);
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

describe("stakePreview", () => {
  it("returns the stake and what a right call pays on top", () => {
    expect(stakePreview({ fortune: 1000, confidence: 70, isBigOne: false, line: 0.35, answer: true }))
      .toEqual({ stake: 40, pays: 74 }); // round(40 × 1.857)
  });
});

describe("fortune never reaches zero (negative control)", () => {
  const worstRound = (f: number) =>
    [95, 95, 95, 95].map((c) => stake(f, c, false)).concat([stake(f, 95, true)]).reduce((a, s) => a + s, 0);
  it("a fully wrong, fully confident round loses 54% of 1000", () => {
    expect(worstRound(1000)).toBe(540);
  });
  it("from any fortune ≥ 1, one round cannot take it to zero", () => {
    for (const f of [1, 2, 5, 9, 10, 11, 100, 1000]) {
      expect(f - worstRound(f)).toBeGreaterThan(0);
    }
  });
});
