import { describe, it, expect } from "vitest";
import { assignEpithet, calibrationVerdict, type EpithetInput } from "../src/epithet";

const base: EpithetInput = {
  completeRounds: 10, tideWins: 0, avgConfidence: 75,
  accuracyPct: 72, majorityRate: 0.6, streakCurrent: 3, resolvedCalls: 40,
};

describe("assignEpithet (spec §6 — priority order, first match wins)", () => {
  it("THE UNREAD below five complete rounds, regardless of everything else", () => {
    const e = assignEpithet({ ...base, completeRounds: 4, tideWins: 9, streakCurrent: 30 });
    expect(e.id).toBe("unread");
    expect(e.receipt).toBe("4 OF 5 COMPLETE DAYS WRITTEN.");
  });
  it("TIDE-FIGHTER outranks calibration at 3+ tide wins, receipt carries the count", () => {
    const e = assignEpithet({ ...base, tideWins: 3, avgConfidence: 65, accuracyPct: 65 });
    expect(e.id).toBe("tide-fighter");
    expect(e.title).toBe("TIDE-FIGHTER");
    expect(e.receipt).toBe("3 TIMES RIGHT AGAINST THE CROWD.");
  });
  it("CALIBRATED SKEPTIC: honest gap and quiet conviction", () => {
    expect(assignEpithet({ ...base, avgConfidence: 65, accuracyPct: 60 }).id).toBe("calibrated-skeptic");
  });
  it("HIGH PRIEST requires an honest gap — loud AND right AND calibrated", () => {
    expect(assignEpithet({ ...base, avgConfidence: 90, accuracyPct: 65 }).id).not.toBe("high-priest"); // gap +25
    expect(assignEpithet({ ...base, avgConfidence: 88, accuracyPct: 80 }).id).toBe("high-priest");   // gap +8
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
    const e = assignEpithet({ completeRounds: 6, tideWins: 0, avgConfidence: null, accuracyPct: null, majorityRate: null, streakCurrent: 0, resolvedCalls: 0 });
    expect(e.id).toBe("keeper");
    expect(e.receipt).toBe("THE LEDGER GROWS. SO DO YOU.");
  });
  it("gap-based epithets need VERDICT_MIN_CALLS resolved calls; otherwise fall through", () => {
    const thin = { ...base, resolvedCalls: 10, avgConfidence: 60, accuracyPct: 80, majorityRate: 0.7, streakCurrent: 0 };
    expect(assignEpithet(thin).id).toBe("keeper"); // not humble-ledger
  });
});

describe("calibrationVerdict (spec §6 — plaque verdict line)", () => {
  it("returns null when either input is null", () => {
    expect(calibrationVerdict(null, 70, 30)).toBe(null);
    expect(calibrationVerdict(70, null, 30)).toBe(null);
    expect(calibrationVerdict(null, null, 30)).toBe(null);
  });
  it("gap of 11 (confidence outruns accuracy)", () => {
    expect(calibrationVerdict(81, 70, 30)).toBe("YOUR CONFIDENCE OUTRUNS YOUR ACCURACY");
  });
  it("gap of -11 (knows more than it claims)", () => {
    expect(calibrationVerdict(59, 70, 30)).toBe("YOU KNOW MORE THAN YOU CLAIM");
  });
  it("gaps of 10, -10, and 0 are honest (boundary is exclusive)", () => {
    expect(calibrationVerdict(80, 70, 30)).toBe("YOUR CONFIDENCE IS HONEST");
    expect(calibrationVerdict(60, 70, 30)).toBe("YOUR CONFIDENCE IS HONEST");
    expect(calibrationVerdict(70, 70, 30)).toBe("YOUR CONFIDENCE IS HONEST");
  });
  it("is silent under VERDICT_MIN_CALLS", () => {
    expect(calibrationVerdict(80, 50, 19)).toBeNull();
    expect(calibrationVerdict(80, 50, 20)).toBe("YOUR CONFIDENCE OUTRUNS YOUR ACCURACY");
  });
  it("names the gap's direction", () => {
    expect(calibrationVerdict(60, 80, 30)).toBe("YOU KNOW MORE THAN YOU CLAIM");
    expect(calibrationVerdict(70, 68, 30)).toBe("YOUR CONFIDENCE IS HONEST");
    expect(calibrationVerdict(null, 68, 30)).toBeNull();
  });
});
