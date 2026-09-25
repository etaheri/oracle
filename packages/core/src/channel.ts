// #nightshift as data (design 2026-09-25 §6.1). Pure: the API hands in rows,
// this orders and tones them, the app prints what comes back.
import { onRightSide, type ModelMemberId } from "./council";
import type { LogLine } from "./schemas";

export interface LogInput {
  lines: { member: ModelMemberId; pYes: number; reasoning: string | null; committedAt: string }[];
  outcome: "yes" | "no" | "void" | null;
  crowd: { yesPct: number | null; count: number | null; resolvedAt: string | null; voidReason: string | null };
  reactions: { member: ModelMemberId; text: string; createdAt: string }[];
  lessons: { member: ModelMemberId; text: string; createdAt: string }[];
}

function toneOf(pYes: number, outcome: LogInput["outcome"]): LogLine["tone"] {
  if (outcome === null || outcome === "void") return "mute";
  const right = onRightSide(pYes, outcome);
  return right === null ? "mute" : right ? "win" : "loss";
}

export function roomLine(outcome: "yes" | "no", yesPct: number, count: number): string {
  const players = `${count} PLAYER${count === 1 ? "" : "S"}`;
  return outcome === "yes" ? `THE ROOM AGREED · ${yesPct}% · ${players}` : `THE ROOM DISAGREED · ${yesPct}% AGREED · ${players}`;
}

export function buildLog(input: LogInput): LogLine[] {
  if (input.lines.length === 0) return [];
  const out: LogLine[] = input.lines.map((l) => ({
    at: l.committedAt, kind: "say", member: l.member, text: (l.reasoning ?? "").trim(), p_yes: l.pYes, tone: toneOf(l.pYes, input.outcome),
  }));
  const { outcome, crowd } = input;
  if (outcome !== null && crowd.resolvedAt !== null) {
    const text = outcome === "void"
      ? (crowd.voidReason ?? "VOID")
      : roomLine(outcome, crowd.yesPct ?? 0, crowd.count ?? 0);
    out.push({ at: crowd.resolvedAt, kind: "system", member: null, text, p_yes: null, tone: "mute" });
  }
  for (const r of input.reactions) out.push({ at: r.createdAt, kind: "say", member: r.member, text: r.text, p_yes: null, tone: "loss" });
  for (const l of input.lessons) out.push({ at: l.createdAt, kind: "note", member: l.member, text: l.text, p_yes: null, tone: "mute" });
  // Stable by time; ties keep insertion order (member lines, then the room, then reactions, then notes).
  return out
    .map((line, i) => ({ line, i }))
    .sort((a, b) => a.line.at.localeCompare(b.line.at) || a.i - b.i)
    .map((x) => x.line);
}
