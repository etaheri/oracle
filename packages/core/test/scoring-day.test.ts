import { describe, it, expect } from "vitest";
import { dayPoints, oracleScore, vigilMultiplier, vigilPoints } from "../src/scoring";
import { CONSTANTS } from "../src/constants";

describe("dayPoints", () => {
  it("sums per-question points", () => {
    expect(dayPoints([50, -15, 10, 0, 90], false)).toBe(135);
  });
  it("adds 10% first-hour bonus on positive totals only", () => {
    expect(dayPoints([50, 50], true)).toBe(110);
    expect(dayPoints([-50, 10], true)).toBe(-40); // negative day: no bonus
  });
  it("rounds the bonus", () => {
    expect(dayPoints([10, 15], true)).toBe(28); // 25 + round(2.5) = 28
  });
});

describe("oracleScore", () => {
  it("is null below 50 resolved calls", () => {
    expect(oracleScore(Array(49).fill(0.25))).toBeNull();
  });
  it("coin-flipping at 55 ≈ 750-ish: exact for constant briers", () => {
    // constant b=0.25 → 1000×(1−0.25) = 750
    expect(oracleScore(Array(50).fill(0.25))).toBe(750);
  });
  it("perfect calls → 1000, worst → 98", () => {
    expect(oracleScore(Array(50).fill(0))).toBe(1000);
    expect(oracleScore(Array(50).fill(0.9025))).toBe(98);
  });
  it("uses only the most recent 100 (array ordered oldest→newest)", () => {
    const briers = [...Array(100).fill(0.9025), ...Array(100).fill(0)];
    expect(oracleScore(briers)).toBe(1000); // old bad calls aged out
  });
});

describe("vigilMultiplier", () => {
  it("is 1 with no vigil and rises to its ceiling", () => {
    expect(vigilMultiplier(0)).toBe(1);
    expect(vigilMultiplier(1)).toBeCloseTo(1.05, 10);
    expect(vigilMultiplier(CONSTANTS.SHIELD_MIN_STREAK)).toBeCloseTo(1.15, 10);
    expect(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS)).toBeCloseTo(1.5, 10);
  });

  it("holds at the ceiling and never dips below one", () => {
    expect(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS + 1)).toBe(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS));
    expect(vigilMultiplier(400)).toBe(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS));
    expect(vigilMultiplier(-5)).toBe(1);
  });
});

describe("vigilPoints", () => {
  it("weighs a losing day exactly as hard as a winning one", () => {
    // The whole design rests on this. An asymmetric multiplier puts a convex
    // kink at zero and rewards variance -- the bug the additive contrarian
    // bonus was written to remove.
    expect(vigilPoints(100, CONSTANTS.VIGIL_MULT_MAX_DAYS)).toBe(150);
    expect(vigilPoints(-100, CONSTANTS.VIGIL_MULT_MAX_DAYS)).toBe(-150);
  });

  it("leaves a vigil-less day alone", () => {
    expect(vigilPoints(83, 0)).toBe(83);
    expect(vigilPoints(-83, 0)).toBe(-83);
  });
});

describe("the vigil multiplier keeps the scoring rule proper", () => {
  const GRID = [55, 60, 65, 70, 75, 80, 85, 90, 95];

  // The claim is about the EXACT expectation: E[M·S] = M·E[S], so a positive
  // constant fixed before the outcomes cannot move the argmax.
  //
  // It is deliberately NOT written against `payoff()`. questionPoints rounds to
  // whole points for display, and on a one-question day that rounding alone
  // already ties adjacent grid points (at p=0.60, reporting 55 and 60 both
  // score exactly 2) — verified numerically before this test was written. A
  // properness test built on the rounded ladder therefore fails at streak 0,
  // where the multiplier is exactly 1.0, and would have sent an implementer
  // hunting a bug in the scoring engine that is really a display artefact.
  const exactEv = (p: number, c: number, m: number) => {
    const q = c / 100;
    const expectedBrier = p * (q - 1) ** 2 + (1 - p) * q ** 2;
    return m * CONSTANTS.POINTS_SCALE * (CONSTANTS.POINTS_BASELINE - expectedBrier);
  };

  const argmax = (p: number, m: number, f: (p: number, c: number, m: number) => number) =>
    GRID.reduce((best, c) => (f(p, c, m) > f(p, best, m) ? c : best), GRID[0]!);

  it("leaves the honest report optimal at every vigil length", () => {
    for (const streak of [0, 1, 3, 7, 10, 11, 30, 400]) {
      const m = vigilMultiplier(streak);
      for (const c of GRID) {
        expect(argmax(c / 100, m, exactEv), `p=${c} streak=${streak}`).toBe(c);
      }
    }
  });

  it("proves the test has teeth: a wins-only multiplier pays for overconfidence", () => {
    // The intuitive "reward the streak" reading, kept as a negative control. It
    // is convex at zero, and a convex transform of a proper score rewards
    // variance: every honest belief is beaten by a louder one (55 wants 65,
    // 90 wants 95). If this ever stops failing, the test above has gone blind.
    const winsOnly = (p: number, c: number, m: number) => {
      const q = c / 100;
      const win = CONSTANTS.POINTS_SCALE * (CONSTANTS.POINTS_BASELINE - (q - 1) ** 2);
      const loss = CONSTANTS.POINTS_SCALE * (CONSTANTS.POINTS_BASELINE - q ** 2);
      return p * (win > 0 ? m * win : win) + (1 - p) * (loss > 0 ? m * loss : loss);
    };
    const m = vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS);
    for (const c of GRID.slice(0, -1)) {
      expect(argmax(c / 100, m, winsOnly), `p=${c}`).toBeGreaterThan(c);
    }
  });
});
