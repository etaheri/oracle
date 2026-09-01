import { describe, expect, it } from "vitest";
import { crowdDrift, lateEdge, earlyLockRate, leakReport, type SealRow } from "../src/pipeline/leak";

const at = (min: number, answer: boolean, brier: number | null = null): SealRow => ({
  createdAt: new Date(Date.UTC(2026, 7, 27, 16, min)),
  answer,
  brier,
});

describe("crowdDrift", () => {
  it("is null below eight seals — a quartile of two is not a signal", () => {
    expect(crowdDrift([at(0, true), at(1, false), at(2, true)])).toBeNull();
  });

  it("is zero when the crowd never changed its mind", () => {
    // 12 seals, every third one YES: the first quartile (0,1,2) and the last
    // (9,10,11) both run 1-in-3 YES, so the split never moved.
    const rows = Array.from({ length: 12 }, (_, i) => at(i, i % 3 === 0));
    expect(crowdDrift(rows)).toBe(0);
  });

  it("measures the swing between the first and last quartile of sealers", () => {
    // 12 seals: first 3 all NO, last 3 all YES → 0% vs 100% → 100pp.
    const rows = [
      ...[0, 1, 2].map((m) => at(m, false)),
      ...[3, 4, 5, 6, 7, 8].map((m) => at(m, m % 2 === 0)),
      ...[9, 10, 11].map((m) => at(m, true)),
    ];
    expect(crowdDrift(rows)).toBe(100);
  });

  it("sorts by seal time, not array order", () => {
    const rows = [...[9, 10, 11].map((m) => at(m, true)), ...[0, 1, 2].map((m) => at(m, false)),
      ...[3, 4, 5, 6, 7, 8].map((m) => at(m, m % 2 === 0))];
    expect(crowdDrift(rows)).toBe(100);
  });
});

describe("lateEdge", () => {
  it("is null below eight rated rows", () => {
    expect(lateEdge([at(0, true, 0.1), at(1, true, 0.1)])).toBeNull();
  });

  it("is positive when the later half scored better (lower brier)", () => {
    const rows = [
      ...[0, 1, 2, 3].map((m) => at(m, true, 0.25)),
      ...[4, 5, 6, 7].map((m) => at(m, true, 0.05)),
    ];
    expect(lateEdge(rows)).toBeCloseTo(0.2, 10);
  });

  it("ignores unrated rows entirely", () => {
    const rows = [
      ...[0, 1, 2, 3].map((m) => at(m, true, 0.25)),
      at(4, true, null),
      ...[5, 6, 7, 8].map((m) => at(m, true, 0.05)),
    ];
    expect(lateEdge(rows)).toBeCloseTo(0.2, 10);
  });
});

describe("earlyLockRate", () => {
  const noon = new Date("2026-08-28T16:00:00Z");
  it("counts questions that closed before the round did", () => {
    expect(earlyLockRate(
      [{ locksAt: new Date("2026-08-27T22:00:00Z") }, { locksAt: noon }, { locksAt: noon }],
      noon,
    )).toBe("1/3");
  });
});

describe("leakReport", () => {
  const noon = new Date("2026-08-28T16:00:00Z");
  it("renders one line per slot plus the rate, and says so when a slot has too few seals", () => {
    const out = leakReport([
      { slot: 1, drift: 12, edge: 0.031, locksAt: new Date("2026-08-27T22:00:00Z") },
      { slot: 2, drift: null, edge: null, locksAt: noon },
    ], noon);
    expect(out[0]).toBe("LEAK WATCH");
    expect(out[1]).toBe("1 drift 12pp · late edge +0.031 · locks 2026-08-27T22:00Z");
    expect(out[2]).toBe("2 too few seals · locks noon");
    expect(out[3]).toBe("early-lock rate 1/2");
  });
});
