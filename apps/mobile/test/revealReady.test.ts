import { describe, it, expect } from "vitest";
import { revealReady } from "../src/game/revealReady";
import type { Reveal } from "@oracle/core";

const q = (my: Reveal["questions"][number]["my"]): Reveal["questions"][number] => ({
  id: "00000000-0000-0000-0000-000000000001", slot: 1, text: "Q?", outcome: "yes", crowd_yes_pct: 60, market_prob: null, my,
  source_name: "S", source_url: null, evidence_quote: null, void_reason: null, oracle_p_yes: null,
});
const reveal = (my: Reveal["questions"][number]["my"]): Reveal => ({
  date: "2026-08-27", day_points: 10, first_hour: false, questions: [q(my)],
  ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null },
});

describe("revealReady", () => {
  it("announces only a ledger the player took part in", () => {
    expect(revealReady(reveal({ answer: true, confidence: 75, points: 10, brier: 0.0625 }))).toBe(true);
    expect(revealReady(reveal(null))).toBe(false); // lapsed day — nothing to read
    expect(revealReady({ pending: true })).toBe(false);
    expect(revealReady(null)).toBe(false);
    expect(revealReady(undefined)).toBe(false);
  });
});
