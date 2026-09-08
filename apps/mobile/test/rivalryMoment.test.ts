import { describe, expect, it } from "vitest";
import { calculateDuel, type DuelQuestion, type DuelResult } from "@oracle/core";
import { rivalryMoment } from "../src/game/rivalryMoment";

const question = (overrides: Partial<DuelQuestion> = {}): DuelQuestion => ({
  id: "q1", slot: 1, is_big_one: false, outcome: "yes", oracle_p_yes: 0.65,
  my: { answer: true, confidence: 85 }, ...overrides,
});

const complete = (highlightId = "q1", winner: "you" | "oracle" | "tie" = "you"): DuelResult => ({
  status: "complete", youPoints: 1, oraclePoints: 0, winner, scoredCount: 3,
  youCorrect: 2, oracleCorrect: 1, oracleAbstained: 0, highlightId,
});

describe("rivalryMoment", () => {
  it("explains a same-call confidence gap without calling it decisive", () => {
    expect(rivalryMoment([question()], complete())).toEqual({
      questionId: "q1", kind: "confidence", line: "You were both right. Your higher confidence earned more.",
    });
  });

  it("credits a correct opposite call without turning it into a round win", () => {
    const moment = rivalryMoment([question({ oracle_p_yes: 0.2 })], complete("q1", "oracle"));
    expect(moment).toMatchObject({ kind: "opposite_calls", line: "You saw what the Oracle missed on this call." });
    expect(moment?.line.toLowerCase()).not.toContain("round");
  });

  it("describes an opposite-call loss locally", () => {
    expect(rivalryMoment([question({ outcome: "no", oracle_p_yes: 0.2 })], complete())).toMatchObject({
      kind: "opposite_calls", line: "The Oracle saw what you missed on this call.",
    });
  });

  it("names an Oracle abstention", () => {
    expect(rivalryMoment([question({ oracle_p_yes: 0.5 })], complete())).toMatchObject({
      kind: "abstention", line: "The Oracle stayed at 50%. You took a side.",
    });
  });

  it("returns no moment for a zero gap or a non-complete duel", () => {
    const tied = question({ oracle_p_yes: 0.85 });
    expect(rivalryMoment([tied], complete("q1", "tie"))).toBeNull();
    for (const status of ["pending", "incomplete", "insufficient", "unavailable"] as const) {
      expect(rivalryMoment([question()], { status })).toBeNull();
    }
  });

  it("returns no moment when highlighted evidence is void, pending, or missing", () => {
    expect(rivalryMoment([question({ outcome: "void" })], complete())).toBeNull();
    expect(rivalryMoment([question({ outcome: null })], complete())).toBeNull();
    expect(rivalryMoment([question({ my: null })], complete())).toBeNull();
    expect(rivalryMoment([question()], complete("missing"))).toBeNull();
  });

  it("does not claim the overall winner from a highlight favoring the overall loser", () => {
    const qs = [
      question({ id: "highlight", oracle_p_yes: 0.05, my: { answer: true, confidence: 95 } }),
      question({ id: "q2", slot: 2, oracle_p_yes: 0.95, my: { answer: false, confidence: 95 } }),
      question({ id: "q3", slot: 3, oracle_p_yes: 0.95, my: { answer: false, confidence: 95 } }),
    ];
    const duel = calculateDuel(qs, 2);
    expect(duel).toMatchObject({ status: "complete", winner: "oracle", highlightId: "highlight" });
    expect(rivalryMoment(qs, duel)?.line).toBe("You saw what the Oracle missed on this call.");
  });
});

// The lesson must distinguish prudent uncertainty from costly overconfidence.
it("explains confidence on both right and wrong calls, including NO", () => {
  expect(rivalryMoment([question({ outcome: "no" })], complete())?.line).toContain("Your higher confidence cost more");
  expect(rivalryMoment([question({ outcome: "no", oracle_p_yes: .95 })], complete())?.line).toContain("Your lower confidence cost less");
  expect(rivalryMoment([question({ oracle_p_yes: .95 })], complete())?.line).toContain("Oracle's higher confidence earned more");
  expect(rivalryMoment([question({ outcome: "no", oracle_p_yes: .35, my: { answer: false, confidence: 85 } })], complete())?.line).toContain("Your higher confidence earned more");
});
