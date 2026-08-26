import { describe, it, expect } from "vitest";
import { assignEpithet, type EpithetInput } from "../src/epithet";

const base: EpithetInput = {
  completeRounds: 10, tideWins: 0, avgConfidence: 75,
  accuracyPct: 72, majorityRate: 0.6, streakCurrent: 3,
};

describe("assignEpithet (spec §6 — priority order, first match wins)", () => {
  it("THE UNREAD below five complete rounds, regardless of everything else", () => {
    const e = assignEpithet({ ...base, completeRounds: 4, tideWins: 9, streakCurrent: 30 });
    expect(e.id).toBe("unread");
    expect(e.receipt).toBe("THE LEDGER KNOWS TOO LITTLE OF YOU.");
  });
  it("TIDE-FIGHTER outranks calibration at 3+ tide wins, receipt carries the count", () => {
    const e = assignEpithet({ ...base, tideWins: 3, avgConfidence: 65, accuracyPct: 65 });
    expect(e.id).toBe("tide-fighter");
    expect(e.title).toBe("TIDE-FIGHTER");
    expect(e.receipt).toBe("3 TIMES AGAINST THE CROWD. 3 TIMES RIGHT.");
  });
  it("CALIBRATED SKEPTIC: honest gap and quiet conviction", () => {
    expect(assignEpithet({ ...base, avgConfidence: 65, accuracyPct: 60 }).id).toBe("calibrated-skeptic");
  });
  it("HIGH PRIEST OF CONVICTION: loud and right", () => {
    expect(assignEpithet({ ...base, avgConfidence: 90, accuracyPct: 65 }).id).toBe("high-priest");
  });
  it("THE HUMBLE LEDGER: knows more than it claims", () => {
    expect(assignEpithet({ ...base, avgConfidence: 60, accuracyPct: 80 }).id).toBe("humble-ledger");
  });
  it("TRUE BELIEVER at 80% majority; ORACLE OF THE MINORITY at 35% minority", () => {
    expect(assignEpithet({ ...base, majorityRate: 0.85 }).id).toBe("true-believer");
    expect(assignEpithet({ ...base, majorityRate: 0.6 }).id).toBe("minority-oracle");
  });
  it("THE UNSHAKEN at a 7-day streak, receipt carries the streak", () => {
    const e = assignEpithet({ ...base, majorityRate: 0.7, streakCurrent: 9 });
    expect(e.id).toBe("unshaken");
    expect(e.receipt).toBe("9 DAYS WITHOUT SILENCE.");
  });
  it("KEEPER OF THE LEDGER is the floor; null stats skip their rules safely", () => {
    const e = assignEpithet({ completeRounds: 6, tideWins: 0, avgConfidence: null, accuracyPct: null, majorityRate: null, streakCurrent: 0 });
    expect(e.id).toBe("keeper");
    expect(e.receipt).toBe("THE LEDGER GROWS. SO DO YOU.");
  });
});
