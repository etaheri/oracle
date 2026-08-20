import { describe, it, expect } from "vitest";
import { settleStreak, type StreakState } from "../src/streak";

const base: StreakState = { streakCurrent: 10, streakBest: 12, freeShieldUsedAt: null, paidShieldsRemaining: 0 };

describe("settleStreak", () => {
  it("increments on played and updates best", () => {
    const r = settleStreak({ ...base, streakCurrent: 12 }, true, "2026-08-20");
    expect(r.streakCurrent).toBe(13);
    expect(r.streakBest).toBe(13);
    expect(r.usedFreeShield).toBe(false);
  });
  it("missed day consumes the free monthly shield first", () => {
    const r = settleStreak(base, false, "2026-08-20");
    expect(r.streakCurrent).toBe(10);
    expect(r.usedFreeShield).toBe(true);
    expect(r.freeShieldUsedAt).toBe("2026-08-20");
  });
  it("free shield unavailable if already used this calendar month", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-08-03" }, false, "2026-08-20");
    expect(r.usedFreeShield).toBe(false);
    expect(r.streakCurrent).toBe(0); // no paid shields either
  });
  it("free shield refreshes in a new month", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-07-31" }, false, "2026-08-01");
    expect(r.usedFreeShield).toBe(true);
    expect(r.streakCurrent).toBe(10);
  });
  it("falls back to paid shield", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-08-03", paidShieldsRemaining: 2 }, false, "2026-08-20");
    expect(r.usedPaidShield).toBe(true);
    expect(r.paidShieldsRemaining).toBe(1);
    expect(r.streakCurrent).toBe(10);
  });
  it("no shields: reset to zero, best preserved", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-08-03" }, false, "2026-08-20");
    expect(r.streakCurrent).toBe(0);
    expect(r.streakBest).toBe(12);
  });
});
