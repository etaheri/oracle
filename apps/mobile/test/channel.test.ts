import { describe, it, expect } from "vitest";
import type { LogLine, Reveal } from "@oracle/core";
import { etClock, channelHeader, nick, printLines, summaryRow, channelCounts, revealLog, DARK_FLOOR, CHANNEL_NAME } from "../src/game/channel";

const QID = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const say = (member: "haiku" | "sonnet" | "opus", p: number | null, text: string, at = "2026-09-25T13:00:00.000Z", tone: LogLine["tone"] = "mute"): LogLine => ({ at, kind: "say", member, text, p_yes: p, tone });
const LOG: LogLine[] = [
  say("haiku", 0.31, "no chance", "2026-09-25T13:00:00.000Z", "loss"),
  say("sonnet", 0.44, "Close, but the room likes a villain.", "2026-09-25T13:00:01.000Z", "loss"),
  say("opus", 0.62, "", "2026-09-25T13:00:02.000Z", "win"),
  { at: "2026-09-26T16:00:00.000Z", kind: "system", member: null, text: "THE ROOM AGREED · 62% · 41 PLAYERS", p_yes: null, tone: "mute" },
  say("haiku", null, "ok the room is wrong", "2026-09-26T16:01:00.000Z", "loss"),
  { at: "2026-09-26T16:02:00.000Z", kind: "note", member: "sonnet", text: "weigh the villain.", p_yes: null, tone: "mute" },
];

describe("the channel's clock (design 2026-09-25 §6.3)", () => {
  it("prints eastern time on a twenty-four hour clock, in summer and in winter", () => {
    expect(etClock("2026-09-25T13:00:00.000Z")).toBe("09:00");
    expect(etClock("2026-09-26T16:14:00.000Z")).toBe("12:14");
    expect(etClock("2026-12-01T14:00:00.000Z")).toBe("09:00");
    expect(etClock("2026-09-26T04:05:00.000Z")).toBe("00:05");
  });
  it("prints a blank clock for an instant it cannot read", () => {
    expect(etClock("not a date")).toBe("--:--");
  });
});

describe("the channel's lines", () => {
  it("heads the block with the channel and the day", () => {
    expect(CHANNEL_NAME).toBe("#nightshift");
    expect(channelHeader("2026-09-25")).toBe("#nightshift · 09-25");
    expect(channelHeader("")).toBe("#nightshift");
  });
  it("brackets a member and stars the room", () => {
    expect(nick("haiku")).toBe("<haiku>");
    expect(nick(null)).toBe("***");
  });
  it("prints each line in order, the share before the words, notes prefixed", () => {
    const out = printLines(LOG);
    expect(out.map((l) => `${l.stamp} ${l.nick} ${l.body}`)).toEqual([
      "09:00 <haiku> 31  no chance",
      "09:00 <sonnet> 44  Close, but the room likes a villain.",
      "09:00 <opus> 62",
      "12:00 *** THE ROOM AGREED · 62% · 41 PLAYERS",
      "12:01 <haiku> ok the room is wrong",
      "12:02 <sonnet> note to self: weigh the villain.",
    ]);
    expect(out.map((l) => l.tone)).toEqual(["loss", "loss", "win", "mute", "loss", "mute"]);
    expect(new Set(out.map((l) => l.key)).size).toBe(out.length);
  });
  it("keeps the member's words as written", () => {
    expect(printLines([say("haiku", 0.31, "lol. no")])[0]!.body).toBe("31  lol. no");
  });
  it("collapses to one row of shares, and to nothing when no machine spoke", () => {
    expect(summaryRow(LOG)).toBe("<haiku> 31 · <sonnet> 44 · <opus> 62");
    expect(summaryRow([])).toBeNull();
    expect(summaryRow([LOG[3]!])).toBeNull();
  });
  it("counts members and reactions for the analytics event", () => {
    expect(channelCounts(LOG)).toEqual({ member_count: 3, reaction_count: 1 });
    expect(channelCounts([])).toEqual({ member_count: 0, reaction_count: 0 });
  });
  it("names the empty floor", () => {
    expect(DARK_FLOOR).toBe("THE FLOOR WAS DARK");
  });
});

describe("the reveal's log (design 2026-09-25 §6.3)", () => {
  const question = (over: Partial<Reveal["questions"][number]> = {}): Reveal["questions"][number] => ({
    id: QID, slot: 5, text: "cereal is a soup", outcome: "yes", crowd_yes_pct: 62, crowd_count: 41, market_prob: null, line_p_yes: 0.44, my: null,
    source_name: "THE PLAYERS", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: null,
    seen_on: null, unhinged: false, crowd: true, resolved_at: "2026-09-26T16:00:00.000Z", ...over,
  });
  const entry = (member: "haiku" | "sonnet" | "market", p: number, committed_at: string | null) => ({ question_id: QID, member, p_yes: p, on_right_side: null, reasoning: member === "market" ? null : `${member} says`, cited: [], lessons_received: 0, committed_at });
  const reveal = (q: Reveal["questions"][number], over: Partial<Reveal> = {}): Reveal => ({
    rules_version: 3, bonus_points: 0, date: "2026-09-25", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: 1,
    delta: 0, return: 0, fortune_after: 1000, house_delta: 0, bust_fortune: null, evidence: [],
    council: [entry("sonnet", 0.44, "2026-09-25T13:00:01.000Z"), entry("haiku", 0.31, "2026-09-25T13:00:00.000Z"), entry("market", 0.4, "2026-09-25T13:00:00.000Z")],
    reactions: [{ question_id: QID, member: "haiku", text: "ok the room is wrong", created_at: "2026-09-26T16:01:00.000Z" }],
    lessons: [{ question_id: QID, member: "sonnet", text: "weigh the villain.", created_at: "2026-09-26T16:02:00.000Z" }],
    questions: [q], ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null }, ...over,
  });

  it("orders the machines, the room, the reactions and the notes, and leaves the market out", () => {
    const q = question();
    const log = revealLog(reveal(q), q);
    expect(log.map((l) => `${l.kind}:${l.member ?? "room"}`)).toEqual(["say:haiku", "say:sonnet", "system:room", "say:haiku", "note:sonnet"]);
    expect(log[0]).toMatchObject({ p_yes: 0.31, tone: "loss", text: "haiku says" });
    expect(log[2]!.text).toBe("THE ROOM AGREED · 62% · 41 PLAYERS");
  });
  it("prints the void reason as the room's line", () => {
    const q = question({ outcome: "void", void_reason: "TOO FEW PLAYERS ANSWERED", crowd_yes_pct: null, crowd_count: null });
    expect(revealLog(reveal(q), q).find((l) => l.kind === "system")!.text).toBe("TOO FEW PLAYERS ANSWERED");
  });
  it("is empty when no machine clocked in on the question", () => {
    const q = question();
    expect(revealLog(reveal(q, { council: [] }), q)).toEqual([]);
  });
  it("takes only this question's remarks", () => {
    const q = question();
    const other = "6e4f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
    const d = reveal(q, { reactions: [{ question_id: other, member: "opus", text: "elsewhere", created_at: "2026-09-26T16:01:00.000Z" }], lessons: [] });
    expect(revealLog(d, q).some((l) => l.text === "elsewhere")).toBe(false);
  });
});
