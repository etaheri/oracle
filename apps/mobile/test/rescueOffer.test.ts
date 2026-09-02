import { describe, it, expect } from "vitest";
import { CONSTANTS, settleStreak } from "@oracle/core";
import { rescueOffered, type RescueState } from "../src/game/rescueOffer";

const base: RescueState = {
  atRisk: true,
  streak: CONSTANTS.SHIELD_MIN_STREAK,
  plusActive: false,
  freeShieldAvailable: false,
  paidShields: 0,
};

describe("rescueOffered", () => {
  it("offers the shield at the breaking point of a defensible vigil", () => {
    expect(rescueOffered(base)).toBe(true);
  });
  it("stays silent when the risk notice is not the line showing", () => {
    expect(rescueOffered({ ...base, atRisk: false })).toBe(false);
  });
  it("stays silent when a shield is already in reserve", () => {
    expect(rescueOffered({ ...base, freeShieldAvailable: true })).toBe(false);
    expect(rescueOffered({ ...base, paidShields: 1 })).toBe(false);
  });
  it("stays silent for a subscriber", () => {
    expect(rescueOffered({ ...base, plusActive: true })).toBe(false);
  });

  // The honesty rule this module exists for: the risk line fires from a
  // two-day vigil, the shield only defends from three. Below the floor the
  // sale promised something the engine would refuse to do.
  it("never offers a shield below the streak the engine will spend one on", () => {
    for (let streak = 0; streak < CONSTANTS.SHIELD_MIN_STREAK; streak++) {
      expect(rescueOffered({ ...base, streak }), `streak=${streak}`).toBe(false);
    }
  });
  it("agrees with settleStreak: an offered shield is always a shield that would be spent", () => {
    for (let streak = 0; streak <= 10; streak++) {
      const offered = rescueOffered({ ...base, streak });
      // What the engine would do with a bought shield, on a missed noon.
      const settled = settleStreak(
        { streakCurrent: streak, streakBest: streak, freeShieldUsedAt: "2026-09-01", paidShieldsRemaining: 1 },
        false,
        "2026-09-02",
      );
      expect(offered, `streak=${streak}`).toBe(settled.usedPaidShield);
    }
  });
});
