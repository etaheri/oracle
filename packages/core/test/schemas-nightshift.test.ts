import { describe, it, expect } from "vitest";
import { RoundTodaySchema, TodayLogSchema, RevealSchema, StandingsSchema, ExhibitionSchema, CouncilEntrySchema } from "../src";

const qid = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const q = { id: qid, slot: 1, is_big_one: false, text: "cereal is a soup", category: "culture", source_name: "THE PLAYERS", resolution_criteria: "rules", locks_at: "2026-09-26T16:00:00.000Z", lock_healed: false };
const line = { at: "2026-09-25T13:00:00.000Z", kind: "say", member: "haiku", text: "no chance", p_yes: 0.31, tone: "mute" };

describe("the night shift on the wire (design 2026-09-25 §11)", () => {
  it("RoundToday carries the shift clock and each take's provenance, defaulting all three", () => {
    const r = RoundTodaySchema.parse({ rules_version: 3, date: "2026-09-25", locks_at: null, player_count: 0, questions: [q] });
    expect(r.council_committed_at).toBeNull();
    expect(r.questions[0]).toMatchObject({ crowd: false, seen_on: null, unhinged: false });
    const s = RoundTodaySchema.parse({ rules_version: 3, date: "2026-09-25", locks_at: null, player_count: 0, council_committed_at: "2026-09-25T13:00:00.000Z", questions: [{ ...q, crowd: true, seen_on: { label: "r/x", url: null }, unhinged: true }] });
    expect(s.questions[0]!.seen_on).toEqual({ label: "r/x", url: null });
  });
  it("TodayLog is per sealed question with the line and the log", () => {
    const t = TodayLogSchema.parse({ questions: [{ question_id: qid, line_p_yes: 0.38, log: [line] }] });
    expect(t.questions[0]!.log[0]!.member).toBe("haiku");
    expect(() => TodayLogSchema.parse({ questions: [{ question_id: "nope", line_p_yes: null, log: [] }] })).toThrow();
  });
  it("Reveal carries reactions, lessons and commit instants, all defaulted", () => {
    const base = { rules_version: 3, date: "2026-09-25", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: null, questions: [], ledger: { settled: false, streak: 0, calls_rated: 0, oracle_score: null } };
    const r = RevealSchema.parse(base);
    expect(r.reactions).toEqual([]);
    expect(r.lessons).toEqual([]);
    const s = RevealSchema.parse({ ...base, reactions: [{ question_id: qid, member: "haiku", text: "lmao", created_at: "2026-09-26T16:02:00.000Z" }], lessons: [{ question_id: qid, member: "opus", text: "note", created_at: "2026-09-26T16:03:00.000Z" }] });
    expect(s.reactions[0]!.member).toBe("haiku");
    expect(CouncilEntrySchema.parse({ question_id: qid, member: "sonnet", p_yes: 0.4, on_right_side: null, reasoning: null, cited: [], lessons_received: 0 }).committed_at).toBeNull();
  });
  it("Standings rows carry a read rate and a title; the payload a window", () => {
    const s = StandingsSchema.parse({ as_of: "2026-09-25T00:00:00.000Z", rounds: 1, questions: 5, rows: [{ member: "haiku", calls: 30, brier: 0.2, house_delta: 0, read_rate: 0.6, title: "night shift" }, { member: "crowd", calls: 30, brier: null, house_delta: 0 }] });
    expect(s.window).toBeNull();
    expect(s.rows[1]).toMatchObject({ read_rate: null, title: null });
  });
  it("Exhibition carries a log, defaulting to empty", () => {
    const e = ExhibitionSchema.parse({ id: "x", kind: "historical", question: "cereal is a soup", context: null, sourceName: "THE PLAYERS", roundDate: "2026-09-25", oraclePYes: 0.38, outcome: "yes", crowdYesPct: 62 });
    expect(e.log).toEqual([]);
  });
});
