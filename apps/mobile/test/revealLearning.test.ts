import { describe, expect, it } from "vitest";
import type { DuelQuestion, DuelResult } from "@oracle/core";
import { revealLearning } from "../src/game/revealLearning";
const q: DuelQuestion = { id: "a", slot: 1, is_big_one: false, outcome: "no", oracle_p_yes: .5, my: { answer: true, confidence: 80 } };
const duel: DuelResult = { status: "complete", youPoints: 0, oraclePoints: 0, winner: "tie", scoredCount: 3, youCorrect: 1, oracleCorrect: 1, oracleAbstained: 1, highlightId: "a" };
describe("reveal learning", () => {
  it("uses base points and keeps neutral Oracle forecasts valid", () => {
    expect(revealLearning(q, 2, duel)).toEqual({ playerBasePoints: -78, oracleBasePoints: 0, gap: -78, doubleWeight: false });
  });
  it("counts NO choices symmetrically and doubles the Big One", () => {
    expect(revealLearning({ ...q, my: { answer: false, confidence: 80 }, is_big_one: true }, 2, duel)?.playerBasePoints).toBe(84);
  });
  it("does not explain pending, void or unanswered calls", () => {
    for (const outcome of [null, "void"] as const) expect(revealLearning({ ...q, outcome }, 2, duel)).toBeNull();
    expect(revealLearning({ ...q, my: null }, 2, duel)).toBeNull();
  });
  it("omits comparisons for legacy, missing Oracle or incomplete duel", () => {
    expect(revealLearning(q, 1, duel)?.gap).toBeNull();
    expect(revealLearning({ ...q, oracle_p_yes: null }, 2, duel)?.gap).toBeNull();
    expect(revealLearning(q, 2, { status: "pending" })?.gap).toBeNull();
  });
});
