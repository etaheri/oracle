import { describe, it, expect } from "vitest";
import { medianLine, sideOf, onRightSide, memberBrier, memberHouseDelta, standingsRow, MEMBER_ORDER } from "../src/council";
import { payout, clampLine } from "../src/fortune";

describe("the median (spec §7)", () => {
  it("is null under two values", () => {
    expect(medianLine([])).toBeNull();
    expect(medianLine([0.4])).toBeNull();
  });
  it("is the mean of two and the middle of three", () => {
    expect(medianLine([0.4, 0.3])).toBeCloseTo(0.35, 10);
    expect(medianLine([0.44, 0.31, 0.40])).toBe(0.40);
  });
  it("is the mean of the middle two of four", () => {
    expect(medianLine([0.1, 0.2, 0.6, 0.9])).toBeCloseTo(0.4, 10);
  });
});

describe("sides", () => {
  it("is neither at exactly 0.5", () => {
    expect(sideOf(0.5)).toBeNull();
    expect(sideOf(0.51)).toBe("yes");
    expect(sideOf(0.49)).toBe("no");
  });
  it("is null on void and on an undecided outcome", () => {
    expect(onRightSide(0.7, "void")).toBeNull();
    expect(onRightSide(0.7, null)).toBeNull();
    expect(onRightSide(0.5, "yes")).toBeNull();
    expect(onRightSide(0.7, "yes")).toBe(true);
    expect(onRightSide(0.7, "no")).toBe(false);
  });
});

describe("member Brier", () => {
  it("is the squared distance to the outcome", () => {
    expect(memberBrier(0.7, "yes")).toBeCloseTo(0.09, 10);
    expect(memberBrier(0.7, "no")).toBeCloseTo(0.49, 10);
  });
});

describe("member house delta (spec C5)", () => {
  const preds = [{ answer: true, stake: 50 }, { answer: false, stake: 30 }, { answer: true, stake: 10 }];
  it("equals the real house delta when the member's line is the house line", () => {
    const line = clampLine(0.35, 0.40);
    const expected = preds.reduce((s, p) => s + p.stake - payout({ stake: p.stake, answer: p.answer, line, outcome: "yes" }), 0);
    expect(memberHouseDelta({ line: 0.35, marketProb: 0.40, outcome: "yes", predictions: preds })).toBe(expected);
  });
  it("clamps a wild line to the market band before pricing", () => {
    const wild = memberHouseDelta({ line: 0.02, marketProb: 0.40, outcome: "yes", predictions: preds });
    const edge = memberHouseDelta({ line: 0.25, marketProb: 0.40, outcome: "yes", predictions: preds });
    expect(wild).toBe(edge);
  });
  it("is zero on a void", () => {
    expect(memberHouseDelta({ line: 0.35, marketProb: 0.40, outcome: "void", predictions: preds })).toBe(0);
  });
  it("is zero with no stakes", () => {
    expect(memberHouseDelta({ line: 0.35, marketProb: null, outcome: "no", predictions: [] })).toBe(0);
  });
});

describe("standings row", () => {
  it("aggregates calls, mean Brier and house delta", () => {
    const row = standingsRow([
      { p: 0.7, marketProb: 0.6, outcome: "yes", predictions: [{ answer: true, stake: 100 }] },
      { p: 0.2, marketProb: 0.3, outcome: "yes", predictions: [{ answer: false, stake: 100 }] },
    ]);
    expect(row.calls).toBe(2);
    expect(row.brier).toBeCloseTo((0.09 + 0.64) / 2, 10);
    // Call 1: player YES at line 0.7 pays 100 + round(100 × 0.3/0.7) = 143 → house −43.
    // Call 2: player NO at line 0.2, outcome YES → house +100.
    expect(row.house_delta).toBe(57);
  });
  it("has a null Brier with no calls", () => {
    expect(standingsRow([])).toEqual({ calls: 0, brier: null, house_delta: 0 });
  });
  it("keeps the fixed member order", () => {
    expect(MEMBER_ORDER).toEqual(["sonnet", "opus", "haiku", "market"]);
  });
});
