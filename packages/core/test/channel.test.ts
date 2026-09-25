import { describe, it, expect } from "vitest";
import { buildLog, LogLineSchema } from "../src";

const say = (member: "sonnet" | "opus" | "haiku", pYes: number, reasoning: string | null = "why") => ({ member, pYes, reasoning, committedAt: "2026-09-25T13:00:00.000Z" });
const undecided = { yesPct: null, count: null, resolvedAt: null, voidReason: null };

describe("buildLog (design 2026-09-25 §6.1)", () => {
  it("orders member lines by commit time, mute before the outcome, with no system line", () => {
    const log = buildLog({ lines: [say("opus", 0.4), { ...say("haiku", 0.31), committedAt: "2026-09-25T12:59:00.000Z" }], outcome: null, crowd: undecided, reactions: [], lessons: [] });
    expect(log.map((l) => l.member)).toEqual(["haiku", "opus"]);
    expect(log.every((l) => l.kind === "say" && l.tone === "mute")).toBe(true);
    expect(log[0]).toMatchObject({ p_yes: 0.31, text: "why" });
    for (const l of log) LogLineSchema.parse(l);
  });
  it("adds the room's system line at resolution, tones each member by side, and appends reactions and notes", () => {
    const log = buildLog({
      lines: [say("haiku", 0.31), say("sonnet", 0.44), say("opus", 0.70)],
      outcome: "yes",
      crowd: { yesPct: 62, count: 41, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null },
      reactions: [{ member: "haiku", text: "ok the room is wrong", createdAt: "2026-09-26T16:02:00.000Z" }],
      lessons: [{ member: "opus", text: "The room is warmer on food than I model.", createdAt: "2026-09-26T16:03:00.000Z" }],
    });
    expect(log.map((l) => l.kind)).toEqual(["say", "say", "say", "system", "say", "note"]);
    expect(log.map((l) => l.tone)).toEqual(["loss", "loss", "win", "mute", "loss", "mute"]);
    expect(log[3]).toMatchObject({ member: null, text: "THE ROOM AGREED · 62% · 41 PLAYERS", p_yes: null });
    expect(log[4]).toMatchObject({ member: "haiku", text: "ok the room is wrong" });
    expect(log[5]).toMatchObject({ member: "opus", kind: "note" });
  });
  it("phrases a NO majority as the room disagreeing", () => {
    const log = buildLog({ lines: [say("haiku", 0.6)], outcome: "no", crowd: { yesPct: 38, count: 41, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null }, reactions: [], lessons: [] });
    expect(log[1]!.text).toBe("THE ROOM DISAGREED · 38% AGREED · 41 PLAYERS");
    expect(log[0]!.tone).toBe("loss");
  });
  it("prints the void reason as the system line and leaves every member mute", () => {
    const log = buildLog({ lines: [say("haiku", 0.6)], outcome: "void", crowd: { yesPct: 50, count: 2, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: "THE ROOM SPLIT EXACTLY IN HALF" }, reactions: [], lessons: [] });
    expect(log[1]).toMatchObject({ kind: "system", text: "THE ROOM SPLIT EXACTLY IN HALF" });
    expect(log[0]!.tone).toBe("mute");
  });
  it("a 0.5 line is mute even after the outcome, and a member with no reasoning still says its number", () => {
    const log = buildLog({ lines: [say("sonnet", 0.5, null)], outcome: "yes", crowd: { yesPct: 60, count: 30, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null }, reactions: [], lessons: [] });
    expect(log[0]).toMatchObject({ tone: "mute", text: "" });
  });
  it("is empty with no lines", () => {
    expect(buildLog({ lines: [], outcome: "yes", crowd: { yesPct: 60, count: 30, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null }, reactions: [], lessons: [] })).toEqual([]);
  });
});
