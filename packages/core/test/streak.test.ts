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
  it("does not spend any shield on a vigil shorter than SHIELD_MIN_STREAK", () => {
    const r = settleStreak({ ...base, streakCurrent: 2, paidShieldsRemaining: 3 }, false, "2026-08-20");
    expect(r.streakCurrent).toBe(0);
    expect(r.usedFreeShield).toBe(false);
    expect(r.usedPaidShield).toBe(false);
    expect(r.freeShieldUsedAt).toBeNull();
    expect(r.paidShieldsRemaining).toBe(3);
  });
  it("spends the free shield exactly at SHIELD_MIN_STREAK", () => {
    const r = settleStreak({ ...base, streakCurrent: 3 }, false, "2026-08-20");
    expect(r.usedFreeShield).toBe(true);
    expect(r.streakCurrent).toBe(3);
  });
});

import { calculateDuel, type DuelQuestion } from "../src/duel";
it("one call maintains participation without earning a ranked duel", () => {
  const questions: DuelQuestion[] = Array.from({ length: 5 }, (_, i) => ({
    id: String(i), slot: i + 1, is_big_one: i === 4, outcome: "yes", oracle_p_yes: .7,
    my: i === 0 ? { answer: true, confidence: 70 } : null,
  }));
  expect(settleStreak(base, questions.some(q => q.my !== null), "2026-08-20").streakCurrent).toBe(11);
  expect(calculateDuel(questions, 2).status).toBe("incomplete");
});
it("a protected gap adds no played day before the next return", () => {
  const protectedGap = settleStreak(base, false, "2026-08-20");
  expect(protectedGap.streakCurrent).toBe(base.streakCurrent);
  expect(protectedGap.streakBest).toBe(base.streakBest);
  expect(settleStreak(protectedGap, true, "2026-08-21").streakCurrent).toBe(base.streakCurrent + 1);
});
