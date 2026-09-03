import { describe, it, expect } from "vitest";
import { RoundTodaySchema, RoundNextSchema, RevealSchema, RoundBoardSchema, MeLedgerSchema } from "../src/schemas";

describe("round schemas", () => {
  it("parses a real /round/today payload", () => {
    const payload = {
      date: "2026-08-20",
      locks_at: "2026-08-21T16:00:00.000Z",
      player_count: 3,
      questions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          slot: 1,
          is_big_one: false,
          text: "Q?",
          category: "markets",
          source_name: "S&P",
          resolution_criteria: "close",
          locks_at: "2026-08-21T16:00:00.000Z",
        },
      ],
    };
    expect(RoundTodaySchema.parse(payload)).toEqual(payload);
  });
  it("parses /round/next", () => {
    const payload = { date: "2026-08-21", opens_at: "2026-08-21T16:00:00.000Z" };
    expect(RoundNextSchema.parse(payload)).toEqual(payload);
  });
  it("parses a real reveal payload incl. void and null my", () => {
    const payload = {
      date: "2026-08-20",
      day_points: 224,
      first_hour: true,
      vigil_mult: null,
      questions: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          slot: 4,
          text: "Q?",
          outcome: "void",
          crowd_yes_pct: null,
          crowd_count: null,
          market_prob: null,
          my: null,
          source_name: "NWS",
          source_url: null,
          evidence_quote: null,
          void_reason: "unverifiable by deadline",
          oracle_p_yes: null,
        },
      ],
      ledger: { settled: true, streak: 4, calls_rated: 35, oracle_score: null },
    };
    expect(RevealSchema.parse(payload)).toEqual(payload);
  });
});

const LEDGER_FIXTURE = {
  oracle_score: null,
  percentile: null,
  cohort_size: 12,
  calls_rated: 34,
  calls_answered: 40,
  days_consulted: 5,
  streak: 2,
  accuracy_pct: null,
  avg_confidence: 73,
  tide_wins: 1,
  majority_rate: 0.5,
  free_shield_available: true,
  paid_shields: 0,
  shield_used_on: null,
  claimed: false,
  epithet: { id: "1", title: "CORRECT", receipt: "2026-08-20" },
  computed_through: "2026-08-20",
};

describe("the board's rows", () => {
  it("accepts a field with the Oracle standing in it", () => {
    const parsed = RoundBoardSchema.parse({
      date: "2026-09-03",
      field_size: 9,
      your_points: 96,
      your_rank: 7,
      best_points: 268,
      median_points: 96,
      rows: [
        { name: "THE COLD WITNESS", points: 268, rank: 1, is_you: false, is_oracle: false },
        { name: "THE ORACLE", points: 184, rank: 3, is_you: false, is_oracle: true },
        { name: "THE PATIENT SCRIBE", points: 96, rank: 7, is_you: true, is_oracle: false },
      ],
    });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.find((r) => r.is_oracle)?.name).toBe("THE ORACLE");
  });
  it("accepts an empty row list below the field floor", () => {
    const parsed = RoundBoardSchema.parse({
      date: "2026-09-03", field_size: 2, your_points: 40,
      your_rank: null, best_points: null, median_points: null, rows: [],
    });
    expect(parsed.rows).toEqual([]);
  });
});

describe("the ledger's rivalry block", () => {
  it("carries the machine's score and the days outseen", () => {
    const parsed = MeLedgerSchema.parse({
      ...LEDGER_FIXTURE,
      oracle: { score: null, calls_rated: 34, days_outseen: 4, days_compared: 11 },
    });
    expect(parsed.oracle.days_outseen).toBe(4);
  });
});
