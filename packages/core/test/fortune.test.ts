import { describe, it, expect } from "vitest";
import {
  FORTUNE, stakeFraction, stake, odds, payout, delta, clampLine, dayReturn, stakePreview,
  LADDER_CONFIDENCES, LADDER_DEFAULT, stakeLadder,
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

describe("the five-rung ladder (spec §4.2, D13)", () => {
  it("offers 55, 65, 75, 85, 95 and defaults to 75", () => {
    expect([...LADDER_CONFIDENCES]).toEqual([55, 65, 75, 85, 95]);
    expect(LADDER_DEFAULT).toBe(75);
  });

  it("stakes 1, 3, 5, 7, 9 percent of a 1,000 fortune on an ordinary card", () => {
    const rungs = stakeLadder({ fortune: 1000, isBigOne: false, line: 0.35, answer: true });
    expect(rungs.map((r) => r.stake)).toEqual([10, 30, 50, 70, 90]);
    expect(rungs.map((r) => r.confidence)).toEqual([55, 65, 75, 85, 95]);
  });

  it("doubles every rung on the Big One", () => {
    const rungs = stakeLadder({ fortune: 1000, isBigOne: true, line: 0.35, answer: true });
    expect(rungs.map((r) => r.stake)).toEqual([20, 60, 100, 140, 180]);
  });

  it("wins at the Oracle's odds for the chosen side", () => {
    // YES at a 35% line pays (1 − 0.35) / 0.35 = 1.857× on top of the stake.
    const yes = stakeLadder({ fortune: 1000, isBigOne: false, line: 0.35, answer: true });
    expect(yes[2]!.wins).toBe(93); // round(50 × 1.857)
    // NO at the same line pays 0.35 / 0.65 = 0.538×.
    const no = stakeLadder({ fortune: 1000, isBigOne: false, line: 0.35, answer: false });
    expect(no[2]!.wins).toBe(27); // round(50 × 0.538)
  });

  it("holds the floor of one below ten percent of a small fortune, and drops it under ten", () => {
    expect(stakeLadder({ fortune: 40, isBigOne: false, line: 0.5, answer: true }).map((r) => r.stake)).toEqual([1, 1, 2, 3, 4]);
    expect(stakeLadder({ fortune: 5, isBigOne: false, line: 0.5, answer: true }).map((r) => r.stake)).toEqual([0, 0, 0, 0, 0]);
  });
});
