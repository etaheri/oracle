import { describe, it, expect } from "vitest";
import { RevealSchema, StandingsSchema, CouncilEntrySchema, EvidenceItemSchema } from "../src/schemas";

const base = {
  rules_version: 3, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: null,
  questions: [{
    id: "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e", slot: 1, text: "Will it?", outcome: "yes", crowd_yes_pct: 60, crowd_count: 12, market_prob: 0.40, line_p_yes: 0.35,
    my: null, source_name: "Kalshi", source_url: null, evidence_quote: null, void_reason: null, oracle_p_yes: 0.35,
  }],
  ledger: { settled: true, streak: 1, calls_rated: 0, oracle_score: null },
};

describe("the Council on the wire (spec §13)", () => {
  it("parses a reveal without council or evidence as empty", () => {
    const r = RevealSchema.parse(base);
    expect(r.council).toEqual([]);
    expect(r.evidence).toEqual([]);
  });
  it("carries entries and items", () => {
    const r = RevealSchema.parse({
      ...base,
      council: [{ question_id: base.questions[0]!.id, member: "sonnet", p_yes: 0.4, on_right_side: false, reasoning: "Because.", cited: [1, 3], lessons_received: 2 },
                { question_id: base.questions[0]!.id, member: "market", p_yes: 0.4, on_right_side: false, reasoning: null, cited: [], lessons_received: 0 }],
      evidence: [{ question_id: base.questions[0]!.id, rank: 1, url: "https://a.example/x", title: "A", source: "a.example", published_at: "2026-09-09T00:00:00.000Z", highlight: "h" }],
    });
    expect(r.council[1]!.reasoning).toBeNull();
    expect(r.evidence[0]!.rank).toBe(1);
  });
  it("rejects a member outside the table", () => {
    expect(CouncilEntrySchema.safeParse({ question_id: base.questions[0]!.id, member: "gpt", p_yes: 0.4, on_right_side: null, reasoning: null, cited: [], lessons_received: 0 }).success).toBe(false);
  });
  it("allows a null published date on evidence", () => {
    expect(EvidenceItemSchema.safeParse({ question_id: base.questions[0]!.id, rank: 2, url: "https://b", title: "B", source: "b", published_at: null, highlight: "h" }).success).toBe(true);
  });
  it("parses standings", () => {
    const s = StandingsSchema.parse({ as_of: "2026-09-11T12:00:00.000Z", rounds: 1, questions: 5, rows: [{ member: "sonnet", calls: 5, brier: 0.2, house_delta: -40 }, { member: "crowd", calls: 5, brier: null, house_delta: 0 }] });
    expect(s.rows[1]!.member).toBe("crowd");
  });
});
