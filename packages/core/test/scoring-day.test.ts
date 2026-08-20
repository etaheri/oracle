import { describe, it, expect } from "vitest";
import { dayPoints, oracleScore } from "../src/scoring";

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
