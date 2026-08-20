import { describe, it, expect } from "vitest";
import { RoundTodaySchema, RevealSchema } from "../src/schemas";

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
        },
      ],
    };
    expect(RoundTodaySchema.parse(payload)).toEqual(payload);
  });
  it("parses a real reveal payload incl. void and null my", () => {
    const payload = {
      date: "2026-08-20",
      day_points: 224,
      questions: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          slot: 4,
          text: "Q?",
          outcome: "void",
          crowd_yes_pct: null,
          my: null,
        },
      ],
    };
    expect(RevealSchema.parse(payload)).toEqual(payload);
  });
});
