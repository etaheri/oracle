import { describe, it, expect } from "vitest";
import { oracleCall, oracleCallRight, oracleQuestionPoints, oracleBrierOf, dayCallCounts, oracleDayTotal } from "../src/oracleRecord";
import { CONSTANTS as C } from "../src/constants";
import { dayPoints, vigilMultiplier, weighDay } from "../src/scoring";

describe("oracleCall", () => {
  it("reads a side from the probability", () => {
    expect(oracleCall(0.83)).toBe("yes");
    expect(oracleCall(0.17)).toBe("no");
  });
  it("treats exactly 0.5 as an abstention, never a coin flip", () => {
    // A forced call is right half the time by construction; counting one
    // would flatter the machine. The Oracle is allowed to decline.
    expect(oracleCall(0.5)).toBeNull();
  });
  it("has no call without a forecast", () => {
    expect(oracleCall(null)).toBeNull();
  });
});

describe("oracleCallRight", () => {
  it("scores a real call against a real outcome", () => {
    expect(oracleCallRight(0.83, "yes")).toBe(true);
    expect(oracleCallRight(0.83, "no")).toBe(false);
    expect(oracleCallRight(0.17, "no")).toBe(true);
  });
  it("leaves the denominator on abstention, void, and no outcome", () => {
    expect(oracleCallRight(0.5, "yes")).toBeNull();
    expect(oracleCallRight(0.83, "void")).toBeNull();
    expect(oracleCallRight(0.83, null)).toBeNull();
    expect(oracleCallRight(null, "yes")).toBeNull();
  });
});

describe("oracleQuestionPoints", () => {
  it("is affine in brier, exactly as questionPoints is", () => {
    // p=0.83 on a YES: brier 0.0289 → 200 × (0.25 − 0.0289) = 44.22 → 44
    expect(oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: false })).toBe(44);
  });
  it("doubles the big one in both directions", () => {
    const win = oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: true });
    const loss = oracleQuestionPoints({ pYes: 0.83, outcome: "no", isBigOne: true });
    expect(win).toBe(2 * oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: false }));
    expect(loss).toBe(2 * oracleQuestionPoints({ pYes: 0.83, outcome: "no", isBigOne: false }));
  });
  it("scores an abstention at exactly zero", () => {
    expect(oracleQuestionPoints({ pYes: 0.5, outcome: "yes", isBigOne: false })).toBe(0);
    expect(oracleQuestionPoints({ pYes: 0.5, outcome: "no", isBigOne: true })).toBe(0);
  });
  it("scores a void at zero", () => {
    expect(oracleQuestionPoints({ pYes: 0.95, outcome: "void", isBigOne: true })).toBe(0);
  });
  // TRIPWIRE (spec §7). Bound to the one path that makes the claim, and
  // proven to ring: change oracleQuestionPoints to add C.CONTRARIAN_BONUS and
  // this test MUST fail. The machine keeps what a call earns and nothing a
  // crowd, a clock, or a purchase confers.
  it("never receives the contrarian bounty, whatever the crowd did", () => {
    const alone = oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: false });
    const withBounty = alone + C.CONTRARIAN_BONUS;
    expect(alone).toBe(44);
    expect(alone).not.toBe(withBounty);
    // oracleQuestionPoints takes no crowd argument at all -- there is no
    // input by which a bounty could reach it. This is the structural half
    // of the guarantee; the numeric assertion above is the tripwire.
    expect(oracleQuestionPoints.length).toBe(1);
  });
});

describe("dayCallCounts", () => {
  const q = (outcome: "yes" | "no" | "void" | null, oracle: number | null, mine: boolean | null) => ({
    outcome,
    oracle_p_yes: oracle,
    my: mine === null ? null : { answer: mine },
  });
  it("counts both sides of the day", () => {
    const counts = dayCallCounts([
      q("yes", 0.8, true),   // both right
      q("no", 0.9, false),   // player right, oracle wrong
      q("yes", 0.7, false),  // oracle right, player wrong
    ]);
    expect(counts).toEqual({ you: 2, oracle: 2 });
  });
  it("drops voids, abstentions and unplayed questions from the counts", () => {
    const counts = dayCallCounts([
      q("void", 0.9, true),
      q("yes", 0.5, true),   // oracle abstains, player right
      q("yes", 0.9, null),   // player never sealed, oracle right
    ]);
    expect(counts).toEqual({ you: 1, oracle: 1 });
  });
});

describe("oracleDayTotal", () => {
  it("takes neither the vigil's weight nor the first hour, on a day where both would show", () => {
    const day = [
      { pYes: 0.83, outcome: "yes" as const, isBigOne: false },
      { pYes: 0.70, outcome: "yes" as const, isBigOne: false },
      { pYes: 0.60, outcome: "no" as const, isBigOne: true },
    ];
    const perQ = day.map(oracleQuestionPoints);
    const plain = perQ.reduce((a, b) => a + b, 0);
    // Both forbidden transforms must MOVE this day -- otherwise the assertions
    // below would hold no matter what oracleDayTotal did.
    expect(weighDay(plain, vigilMultiplier(10))).not.toBe(plain);
    expect(dayPoints(perQ, true)).not.toBe(plain);
    expect(oracleDayTotal(day)).toBe(plain);
  });
});
