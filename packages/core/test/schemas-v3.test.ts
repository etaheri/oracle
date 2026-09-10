import { describe, it, expect } from "vitest";
import { RoundTodaySchema, RevealSchema, RoundBoardSchema, MeLedgerSchema, SubmitResSchema, AllTimeBoardSchema } from "../src/schemas";

const q = {
  id: "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e", slot: 1, is_big_one: false, text: "Will it rain?", category: "weather",
  source_name: "Kalshi", resolution_criteria: "rules", locks_at: "2026-09-11T16:00:00.000Z", lock_healed: false,
};

describe("v3 response fields are optional and typed", () => {
  it("RoundToday accepts rules_version 3, line_p_yes, fortune and house", () => {
    const r = RoundTodaySchema.parse({
      rules_version: 3, date: "2026-09-10", locks_at: null, player_count: 0,
      fortune: 1000, house: { total: -120, last_delta: -120 },
      questions: [{ ...q, line_p_yes: 0.35 }],
    });
    expect(r.questions[0]!.line_p_yes).toBe(0.35);
    expect(r.fortune).toBe(1000);
  });
  it("RoundToday still parses a v2 payload with none of them", () => {
    const r = RoundTodaySchema.parse({ rules_version: 2, date: "2026-09-10", locks_at: null, player_count: 0, questions: [q] });
    expect(r.questions[0]!.line_p_yes).toBeNull();
    expect(r.fortune).toBeNull();
  });
  it("Reveal carries stake, payout, delta and the round's fortune figures", () => {
    const r = RevealSchema.parse({
      rules_version: 3, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: null,
      delta: 86, return: 0.086, fortune_after: 1086, house_delta: -86,
      questions: [{
        id: q.id, slot: 1, text: q.text, outcome: "yes", crowd_yes_pct: 60, crowd_count: 12, market_prob: 0.40, line_p_yes: 0.35,
        my: { answer: true, confidence: 70, points: 30, brier: 0.09, stake: 40, payout: 114, delta: 74 },
        source_name: "Kalshi", source_url: null, evidence_quote: null, void_reason: null, oracle_p_yes: 0.35,
      }],
      ledger: { settled: true, streak: 1, calls_rated: 0, oracle_score: null },
    });
    expect(r.questions[0]!.my!.stake).toBe(40);
    expect(r.fortune_after).toBe(1086);
  });
  it("Board accepts the return metric", () => {
    const b = RoundBoardSchema.parse({
      date: "2026-09-10", metric: "return", field_size: 6, your_points: null, your_rank: 2, best_points: null, median_points: null,
      your_return_bp: 860, best_return_bp: 1240, median_return_bp: 120,
      rows: [{ name: "THE PATIENT", points: 0, return_bp: 1240, rank: 1, is_you: false, is_oracle: false }],
    });
    expect(b.metric).toBe("return");
    expect(b.rows[0]!.return_bp).toBe(1240);
  });
  it("Ledger carries fortune and fortune_history", () => {
    const l = MeLedgerSchema.parse({
      milestones: [], oracle_score: null, percentile: null, cohort_size: 0, calls_rated: 0, calls_answered: 0, days_consulted: 0,
      streak: 0, accuracy_pct: null, avg_confidence: null, tide_wins: 0, majority_rate: null, free_shield_available: true,
      paid_shields: 0, shield_used_on: null, claimed: false, epithet: { id: "novice", title: "THE NOVICE", receipt: "first calls" }, computed_through: "2026-09-10",
      oracle: { score: null, calls_rated: 0, days_outseen: 0, days_compared: 0 },
      fortune: 1086, fortune_history: [{ date: "2026-09-10", delta: 86, fortune_after: 1086 }],
    });
    expect(l.fortune_history[0]!.delta).toBe(86);
  });
  it("SubmitRes carries the frozen stake", () => {
    expect(SubmitResSchema.parse({ id: q.id, first_hour: false, stake: 40 }).stake).toBe(40);
    expect(SubmitResSchema.parse({ id: q.id, first_hour: false }).stake).toBeNull();
  });
});

describe("the all-time board and the ledger's house (spec §7)", () => {
  it("parses a full all-time board", () => {
    const b = AllTimeBoardSchema.parse({
      field_size: 6, your_fortune: 1140, your_rank: 2, best_fortune: 2002, median_fortune: 940,
      rows: [{ name: "Quiet Heron", fortune: 2002, rank: 1, is_you: false }, { name: "You", fortune: 1140, rank: 2, is_you: true }],
    });
    expect(b.rows[1]!.is_you).toBe(true);
  });

  it("parses a sparse all-time board with nulls and no rows", () => {
    const b = AllTimeBoardSchema.parse({ field_size: 2, your_fortune: 1000, your_rank: null, best_fortune: null, median_fortune: null, rows: [] });
    expect(b.your_rank).toBeNull();
  });

  it("defaults the ledger's house to null so an older server still parses", () => {
    // The smallest ledger the schema accepts, with house absent.
    const minimal = {
      oracle_score: null, percentile: null, cohort_size: 0, calls_rated: 0, calls_answered: 0, days_consulted: 0,
      streak: 0, accuracy_pct: null, avg_confidence: null, tide_wins: 0, majority_rate: null,
      free_shield_available: true, paid_shields: 0, shield_used_on: null, claimed: false,
      epithet: { id: "unread", title: "THE UNREAD", receipt: "" }, computed_through: "2026-09-10",
      oracle: { score: null, calls_rated: 0, days_outseen: 0, days_compared: 0 },
    };
    expect(MeLedgerSchema.parse(minimal).house).toBeNull();
    expect(MeLedgerSchema.parse({ ...minimal, house: { total: -1240, last_delta: -1240 } }).house?.total).toBe(-1240);
  });
});
