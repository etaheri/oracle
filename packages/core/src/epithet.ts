// The weekly epithet (voice spec §6): one title, priority-ordered rules,
// first match wins, and every epithet carries its receipt — the plaque never
// asserts identity without evidence. Inputs are computed over a trailing
// 28-day window by the ledger endpoint.

export interface EpithetInput {
  completeRounds: number;
  tideWins: number;
  avgConfidence: number | null;
  accuracyPct: number | null;
  majorityRate: number | null;
  streakCurrent: number;
}

export interface Epithet {
  id: string;
  title: string;
  receipt: string;
}

export function assignEpithet(s: EpithetInput): Epithet {
  if (s.completeRounds < 5) {
    return { id: "unread", title: "THE UNREAD", receipt: "THE LEDGER KNOWS TOO LITTLE OF YOU." };
  }
  if (s.tideWins >= 3) {
    return { id: "tide-fighter", title: "TIDE-FIGHTER", receipt: `${s.tideWins} TIMES AGAINST THE CROWD. ${s.tideWins} TIMES RIGHT.` };
  }
  const gap = s.avgConfidence !== null && s.accuracyPct !== null ? s.avgConfidence - s.accuracyPct : null;
  if (gap !== null && Math.abs(gap) <= 10 && s.avgConfidence! < 70) {
    return { id: "calibrated-skeptic", title: "CALIBRATED SKEPTIC", receipt: "YOU CLAIM LITTLE AND MISS LESS." };
  }
  if (s.avgConfidence !== null && s.accuracyPct !== null && s.avgConfidence >= 85 && s.accuracyPct >= 60) {
    return { id: "high-priest", title: "HIGH PRIEST OF CONVICTION", receipt: "YOU SPEAK LOUDLY AND THE LEDGER AGREES." };
  }
  if (gap !== null && gap < -10) {
    return { id: "humble-ledger", title: "THE HUMBLE LEDGER", receipt: "YOU KNOW MORE THAN YOU CLAIM." };
  }
  if (s.majorityRate !== null && s.majorityRate >= 0.8) {
    return { id: "true-believer", title: "TRUE BELIEVER OF THE CROWD", receipt: "WHERE THE CROWD GOES, YOU GO." };
  }
  if (s.majorityRate !== null && 1 - s.majorityRate >= 0.35) {
    return { id: "minority-oracle", title: "ORACLE OF THE MINORITY", receipt: "YOU WALK WHERE FEW WALK." };
  }
  if (s.streakCurrent >= 7) {
    return { id: "unshaken", title: "THE UNSHAKEN", receipt: `${s.streakCurrent} DAYS WITHOUT SILENCE.` };
  }
  return { id: "keeper", title: "KEEPER OF THE LEDGER", receipt: "THE LEDGER GROWS. SO DO YOU." };
}
