import { expect, it } from "vitest";
import { calculateDuel, type DuelQuestion } from "@oracle/core";
import { revealSummary } from "../src/game/revealSummary";
import { revealObservation } from "../src/game/revealObservation";
const qs = (): DuelQuestion[] => Array.from({ length: 5 }, (_, i) => ({ id: String(i), slot: i + 1, is_big_one: i === 4, outcome: "yes", oracle_p_yes: .75, my: { answer: true, confidence: 75 } }));
it("does not share partial results or diagnose tied confidence", () => {
  const round = qs(); expect(revealObservation(round)).toBeNull();
  round[0]!.outcome = null;
  expect(revealSummary(round, calculateDuel(round)).canShareFinal).toBe(false);
});
it("allows a personal receipt without claiming an Oracle victory", () => {
  const round = qs(); round[0]!.oracle_p_yes = null;
  expect(revealSummary(round, calculateDuel(round))).toMatchObject({ headline: "5 RIGHT · 5 CALLS READ", canShareFinal: true });
});
