export interface StreakState {
  streakCurrent: number;
  streakBest: number;
  freeShieldUsedAt: string | null;
  paidShieldsRemaining: number;
}
export interface StreakResult extends StreakState {
  usedFreeShield: boolean;
  usedPaidShield: boolean;
}

const month = (isoDate: string) => isoDate.slice(0, 7); // "2026-08"

export function settleStreak(state: StreakState, played: boolean, roundDate: string): StreakResult {
  if (played) {
    const streakCurrent = state.streakCurrent + 1;
    return {
      ...state,
      streakCurrent,
      streakBest: Math.max(state.streakBest, streakCurrent),
      usedFreeShield: false,
      usedPaidShield: false,
    };
  }
  const freeAvailable = state.freeShieldUsedAt === null || month(state.freeShieldUsedAt) !== month(roundDate);
  if (freeAvailable) {
    return { ...state, freeShieldUsedAt: roundDate, usedFreeShield: true, usedPaidShield: false };
  }
  if (state.paidShieldsRemaining > 0) {
    return {
      ...state,
      paidShieldsRemaining: state.paidShieldsRemaining - 1,
      usedFreeShield: false,
      usedPaidShield: true,
    };
  }
  return { ...state, streakCurrent: 0, usedFreeShield: false, usedPaidShield: false };
}
