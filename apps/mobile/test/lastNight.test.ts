import { describe, it, expect } from "vitest";
import type { Reveal } from "@oracle/core";
import { lastNightLine } from "../src/game/lastNight";

type Q = Reveal["questions"][number];
const q = (slot: number, outcome: Q["outcome"], answer: boolean | null, over: Partial<Q> = {}): Q => ({
  id: `5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5${slot}`, slot, text: `take ${slot}`, outcome, crowd_yes_pct: 60, crowd_count: 30, market_prob: null, line_p_yes: 0.4,
  my: answer === null ? null : { answer, confidence: 75, points: null, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null, stake: 50, payout: 0, delta: 0, doubled: false, sealed_at: null },
  source_name: "THE PLAYERS", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: null,
  seen_on: null, unhinged: false, crowd: true, resolved_at: "2026-09-27T16:00:00.000Z", ...over,
});
const reveal = (questions: Q[], over: Partial<Reveal> = {}): Reveal => ({
  rules_version: 3, bonus_points: 0, date: "2026-09-26", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: 1,
  delta: 140, return: 0.14, fortune_after: 1140, house_delta: -140, bust_fortune: null, council: [], evidence: [], reactions: [], lessons: [],
  questions, ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null }, ...over,
});

describe("last night on Home (design 2026-09-25 §6.5)", () => {
  it("pairs the night's money with how often the caller read the room", () => {
    const d = reveal([q(1, "yes", true), q(2, "no", false), q(3, "yes", true), q(4, "no", true), q(5, "yes", true)]);
    expect(lastNightLine(d)).toBe("LAST NIGHT · +140 · YOU READ THE ROOM ON 4 OF 5");
  });
  it("prints a loss with a true minus sign, and counts only the takes that settled and were answered", () => {
    const d = reveal([q(1, "yes", false), q(2, "void", true), q(3, "no", null), q(4, "no", false)], { delta: -60 });
    expect(lastNightLine(d)).toBe("LAST NIGHT · −60 · YOU READ THE ROOM ON 1 OF 2");
  });
  it("says nothing while the night is unsettled, unplayed, or was not a night of hot takes", () => {
    expect(lastNightLine(null)).toBeNull();
    expect(lastNightLine(undefined)).toBeNull();
    expect(lastNightLine({ pending: true })).toBeNull();
    expect(lastNightLine(reveal([q(1, "yes", true)], { delta: null }))).toBeNull();
    expect(lastNightLine(reveal([q(1, "yes", null)]))).toBeNull();
    expect(lastNightLine(reveal([q(1, "yes", true, { crowd: false })]))).toBeNull();
  });
});
