import { describe, it, expect } from "vitest";
import { RoundTodaySchema, RoundNextSchema, RevealSchema } from "../src/schemas";

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
      questions: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          slot: 4,
          text: "Q?",
          outcome: "void",
          crowd_yes_pct: null,
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
