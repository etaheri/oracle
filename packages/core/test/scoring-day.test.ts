import { describe, it, expect } from "vitest";
import { dayPoints, oracleScore, vigilMultiplier, vigilPoints, weighDay } from "../src/scoring";
import { CONSTANTS } from "../src/constants";

describe("dayPoints", () => {
  it("sums per-question points", () => {
    expect(dayPoints([50, -15, 10, 0, 90], false)).toBe(135);
  });
  it("weighs the whole first-hour day, won or lost", () => {
    // The first hour is a stake, not a gift. It used to pay only on positive
    // totals -- a wins-only multiplier, convex at zero, which is exactly the
    // shape the vigil's negative control below exists to forbid.
    expect(dayPoints([50, 50], true)).toBe(110);
    expect(dayPoints([-50, -50], true)).toBe(-110);
    expect(dayPoints([-50, 10], true)).toBe(-44);
    expect(dayPoints([-50, 50], true)).toBe(0);
  });
  it("rounds the magnitude, so the losing first hour is never cheaper than its mirror", () => {
    // 27.5 is exactly where Math.round's toward-+infinity tie-breaking shows.
    expect(dayPoints([10, 15], true)).toBe(28);
    expect(dayPoints([-10, -15], true)).toBe(-28);
  });
  it("is exactly the first-hour multiplier, nothing else", () => {
    // The bond between the sweep below (which models the bonus as a plain
    // multiplier on the day's total) and the shipped function.
    for (let total = -400; total <= 400; total++) {
      expect(dayPoints([total], true), `total=${total}`).toBe(weighDay(total, 1 + CONSTANTS.FIRST_HOUR_BONUS));
      expect(dayPoints([total], false), `total=${total}`).toBe(total);
    }
  });
  // A day worth nothing is worth nothing either way round. JS has two zeros
  // and Object.is is the only thing that disagrees, so normalise -0 rather
  // than let the sweeps below assert IEEE-754 instead of symmetry.
  const zeroless = (n: number) => n + 0;

  it("is exactly odd under the first-hour flag, as vigilPoints is", () => {
    for (let total = -400; total <= 400; total++) {
      const xs = [total, -13, 7];
      expect(zeroless(dayPoints(xs.map((x) => -x), true)), `total=${total}`).toBe(zeroless(-dayPoints(xs, true)));
    }
  });
  it("composes with the vigil and stays odd across both multipliers", () => {
    // Two independently-rounded multipliers stack on every first-hour day the
    // reveal shows. Odd ∘ odd is odd -- but only if neither rounding step
    // breaks it, and double rounding is precisely where that would go
    // unnoticed.
    for (const m of [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5]) {
      for (let total = -400; total <= 400; total++) {
        const xs = [total, -13, 7];
        const mirrored = xs.map((x) => -x);
        expect(zeroless(weighDay(dayPoints(mirrored, true), m)), `total=${total} m=${m}`).toBe(
          zeroless(-weighDay(dayPoints(xs, true), m)),
        );
      }
    }
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

describe("weighDay", () => {
  it("rounds the magnitude, so a losing day is never cheaper than its mirror", () => {
    // -31.5 is exactly where Math.round's toward-+infinity tie-breaking shows.
    expect(weighDay(30, 1.05)).toBe(32);
    expect(weighDay(-30, 1.05)).toBe(-32);
  });

  it("is exactly odd across the range both callers use", () => {
    for (const m of [1, 1.05, 1.1, 1.15, 1.35, 1.5]) {
      for (let total = -400; total <= 400; total++) {
        expect(weighDay(-total, m), `total=${total} m=${m}`).toBe(-weighDay(total, m));
      }
    }
  });

  it("leaves a total alone at a multiplier of one", () => {
    expect(weighDay(83, 1)).toBe(83);
    expect(weighDay(-83, 1)).toBe(-83);
    expect(weighDay(0, 1.5)).toBe(0);
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

  it("is exactly odd — a losing day is never cheaper than the winning day of the same size", () => {
    // The single hardcoded ±150 case above passes even when rounding breaks
    // symmetry at half-integers; this sweep is what actually holds the line.
    for (let streak = 0; streak <= 12; streak++) {
      for (let total = -400; total <= 400; total++) {
        expect(vigilPoints(-total, streak), `total=${total} streak=${streak}`).toBe(-vigilPoints(total, streak));
      }
    }
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

describe("the first-hour bonus keeps the scoring rule proper", () => {
  const GRID = [55, 60, 65, 70, 75, 80, 85, 90, 95];

  // Same discipline as the vigil sweep above: the claim is about the EXACT
  // expectation, so this is written against exact EV and never against the
  // rounded `payoff()` ladder, which ties adjacent grid points on its own.
  //
  // The bonus is a PARAMETER here, not CONSTANTS.FIRST_HOUR_BONUS. That is the
  // whole point of the change: properness used to survive only because the
  // 5-point confidence grid was coarser than the distortion, and it broke at
  // 0.11. Routed through weighDay the bonus is a positive constant fixed
  // before any of today's outcomes exist, so E[(1+b)·S] = (1+b)·E[S] and the
  // argmax cannot move at ANY value. Sweeping values far past the shipped one
  // is what asserts the tuning ceiling is gone.
  const BONUSES = [0.1, 0.25, 0.5];

  const win = (c: number, m: number) => m * CONSTANTS.POINTS_SCALE * (CONSTANTS.POINTS_BASELINE - (c / 100 - 1) ** 2);
  const loss = (c: number, m: number) => m * CONSTANTS.POINTS_SCALE * (CONSTANTS.POINTS_BASELINE - (c / 100) ** 2);

  // The day's fifth question, decided against a day already carrying `others`.
  const exactEv = (p: number, c: number, m: number, b: number, others: number) =>
    (1 + b) * (p * (others + win(c, m)) + (1 - p) * (others + loss(c, m)));

  const argmax = (
    p: number,
    m: number,
    b: number,
    others: number,
    f: (p: number, c: number, m: number, b: number, others: number) => number,
  ) => GRID.reduce((best, c) => (f(p, c, m, b, others) > f(p, best, m, b, others) ? c : best), GRID[0]!);

  it("leaves the honest report optimal at every bonus, every slot, and every other-four total", () => {
    for (const b of BONUSES) {
      for (const m of [1, CONSTANTS.BIG_ONE_MULT]) {
        for (let others = -400; others <= 400; others += 5) {
          for (const c of GRID) {
            expect(argmax(c / 100, m, b, others, exactEv), `p=${c} bonus=${b} mult=${m} others=${others}`).toBe(c);
          }
        }
      }
    }
  });

  it("proves the sweep has teeth: the wins-only first hour pays for overconfidence", () => {
    // The shipped shape before this change, kept as a negative control. It
    // multiplies only positive day totals, so it is convex at zero -- and a
    // convex transform of a proper score rewards variance. The kink sits at
    // the DAY's total, not the question's, so it bites when the other four
    // leave the day straddling zero: exactly the case measured in the spec
    // (§1.1), where at 0.11 a p=55 believer is paid to report 60. If this
    // ever stops failing, the sweep above has gone blind.
    const winsOnly = (p: number, c: number, m: number, b: number, others: number) => {
      const weigh = (t: number) => (t > 0 ? t * (1 + b) : t);
      return p * weigh(others + win(c, m)) + (1 - p) * weigh(others + loss(c, m));
    };
    for (const c of GRID.slice(0, -1)) {
      const bought = [];
      for (let others = -400; others <= 400; others++) {
        if (argmax(c / 100, 1, 0.5, others, winsOnly) > c) bought.push(others);
      }
      expect(bought.length, `p=${c}: no other-four total made a louder report pay`).toBeGreaterThan(0);
    }
  });
});
