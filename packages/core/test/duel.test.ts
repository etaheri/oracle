import { describe, it, expect } from "vitest";
import { calculateDuel, type DuelQuestion } from "../src/duel";
import { ratingEligible } from "../src/roundRules";
import { earnedMilestones } from "../src/milestones";
const round = (): DuelQuestion[] => Array.from({ length: 5 }, (_, i) => ({ id: String(i), slot: i + 1, is_big_one: i === 4, outcome: "yes", oracle_p_yes: .75, my: { answer: true, confidence: 75 } }));
describe("the shared duel", () => {
  it("scores identical beliefs identically, including double weight", () => {
    expect(calculateDuel(round())).toMatchObject({ status: "complete", winner: "tie", youPoints: 227, oraclePoints: 227 });
  });
  it("can reward calibration over correct-answer count", () => {
    const qs = round();
    qs.forEach(q => { q.my = { answer: true, confidence: 55 }; q.oracle_p_yes = .95; });
    qs[0]!.my = { answer: false, confidence: 95 };
    qs[1]!.oracle_p_yes = .45; qs[2]!.oracle_p_yes = .45;
    expect(calculateDuel(qs)).toMatchObject({ status: "complete", winner: "oracle", youCorrect: 4, oracleCorrect: 3 });
  });
  it("does not turn incomplete or pending rounds into wins", () => {
    const qs = round(); qs[0]!.outcome = null;
    expect(calculateDuel(qs).status).toBe("pending");
    qs[0]!.outcome = "yes"; qs[0]!.my = null;
    expect(calculateDuel(qs).status).toBe("incomplete");
  });
  it("requires real forecast coverage and permits honest 0.5", () => {
    const qs = round(); qs[0]!.oracle_p_yes = null;
    expect(calculateDuel(qs).status).toBe("unavailable");
    qs[0]!.oracle_p_yes = .5;
    expect(calculateDuel(qs)).toMatchObject({ status: "complete", oracleAbstained: 1 });
    qs[0]!.oracle_p_yes = NaN;
    expect(calculateDuel(qs).status).toBe("unavailable");
  });
  it("makes global voids fair only under the new rules", () => {
    const qs = round(); qs[0]!.outcome = "void"; qs[0]!.my = null;
    expect(calculateDuel(qs, 1).status).toBe("incomplete");
    expect(calculateDuel(qs, 2)).toMatchObject({ status: "complete", scoredCount: 4 });
    qs[1]!.outcome = "void"; qs[2]!.outcome = "void";
    expect(calculateDuel(qs, 2).status).toBe("insufficient");
  });
  it("preserves the complete-day guard against selective answering", () => {
    const qs = round(); const ids = new Set(qs.slice(1).map(q => q.id));
    expect(ratingEligible(2, qs, ids)).toBe(false);
    qs[0]!.outcome = "void";
    expect(ratingEligible(2, qs, ids)).toBe(true);
    expect(ratingEligible(1, qs, ids)).toBe(false);
  });
  it("recognizes factual progress without requiring consecutive days", () => {
    expect(earnedMilestones({ completedRounds: 0, resolvedCompletedRounds: 0, oracleWins: 0 })).toEqual([]);
    expect(earnedMilestones({ completedRounds: 7, resolvedCompletedRounds: 6, oracleWins: 1 })).toEqual(["first_round", "first_result", "first_oracle_win", "three_rounds", "seven_rounds"]);
  });
});
