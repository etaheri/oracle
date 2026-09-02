import { CONSTANTS as C } from "@oracle/core";

// The rescue offer's gate (audit 2026-09-02 §4.1). The risk line itself is
// truthful from a two-day vigil — it really does end at noon — but a shield
// refuses to defend anything shorter than SHIELD_MIN_STREAK: settleStreak
// resets the streak and spends nothing below that floor. Offering "ONE
// SHIELD WOULD HOLD IT" there sold a real-money consumable that provably
// could not fire, at the app's highest-intent moment. The floor now gates
// the sale, not just the spend. Pure — node-tested.
export interface RescueState {
  /** The risk notice is the line currently showing: unsealed, inside the last hours. */
  atRisk: boolean;
  streak: number;
  plusActive: boolean;
  freeShieldAvailable: boolean;
  paidShields: number;
}

export function rescueOffered(s: RescueState): boolean {
  if (!s.atRisk) return false;
  // A shield cannot hold a vigil this short — settleStreak (core) resets it
  // and leaves every shield in reserve.
  if (s.streak < C.SHIELD_MIN_STREAK) return false;
  if (s.plusActive) return false;
  // Nothing to sell while a shield is already in reserve to cover the miss.
  return !s.freeShieldAvailable && s.paidShields === 0;
}
