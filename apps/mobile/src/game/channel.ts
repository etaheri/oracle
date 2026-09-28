// #nightshift on the client (design 2026-09-25 §6). The log is built by the
// core builder the API also uses; this module decides how it prints. Pure:
// ChannelLog and the share card render what these return.
import { buildLog, MODEL_MEMBER_IDS, type LogLine, type ModelMemberId, type Reveal } from "@oracle/core";

export { buildLog };

export const CHANNEL_NAME = "#nightshift";
// The renderer's line for a question no machine clocked in on.
export const DARK_FLOOR = "THE FLOOR WAS DARK";
// Prefixed at render, never stored (design §6.1).
export const NOTE_PREFIX = "note to self: ";

// The channel keeps eastern time: the round opens and locks at noon ET and
// the machines clock in at 09:00 ET, wherever the reader is. `h23` because
// `hour12: false` prints midnight as 24 on some engines.
const ET_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function etClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "--:--";
  const parts = ET_CLOCK.formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

export function channelHeader(date: string): string {
  return date ? `${CHANNEL_NAME} · ${date.slice(5)}` : CHANNEL_NAME;
}

export function nick(member: LogLine["member"]): string {
  return member === null ? "***" : `<${member}>`;
}

export function sharePct(p: number): string {
  return String(Math.round(p * 100));
}

export interface PrintLine { key: string; stamp: string; nick: string; body: string; tone: LogLine["tone"]; kind: LogLine["kind"] }

function bodyOf(l: LogLine): string {
  if (l.kind === "note") return `${NOTE_PREFIX}${l.text}`;
  if (l.kind === "say" && l.p_yes !== null) return [sharePct(l.p_yes), l.text].filter(Boolean).join("  ");
  return l.text;
}

export function printLines(log: ReadonlyArray<LogLine>): PrintLine[] {
  return log.map((l, i) => ({ key: `${i}-${l.at}`, stamp: etClock(l.at), nick: nick(l.member), body: bodyOf(l), tone: l.tone, kind: l.kind }));
}

const guesses = (log: ReadonlyArray<LogLine>) => log.filter((l) => l.kind === "say" && l.member !== null && l.p_yes !== null);

// The collapsed row: every machine's share and nothing else.
export function summaryRow(log: ReadonlyArray<LogLine>): string | null {
  const rows = guesses(log);
  if (rows.length === 0) return null;
  return rows.map((l) => `${nick(l.member)} ${sharePct(l.p_yes!)}`).join(" · ");
}

export function channelCounts(log: ReadonlyArray<LogLine>): { member_count: number; reaction_count: number } {
  return {
    member_count: new Set(guesses(log).map((l) => l.member)).size,
    reaction_count: log.filter((l) => l.kind === "say" && l.p_yes === null).length,
  };
}

const isModel = (m: string): m is ModelMemberId => (MODEL_MEMBER_IDS as readonly string[]).includes(m);

// One question's log from the reveal payload (design §6.3). The market member
// never posts; a Council row with no commit instant cannot be placed in time
// and is left out.
export function revealLog(d: Reveal, q: Reveal["questions"][number]): LogLine[] {
  return buildLog({
    lines: d.council.flatMap((e) =>
      e.question_id === q.id && isModel(e.member) && e.committed_at !== null
        ? [{ member: e.member, pYes: e.p_yes, reasoning: e.reasoning, committedAt: e.committed_at }]
        : [],
    ),
    outcome: q.outcome,
    crowd: { yesPct: q.crowd_yes_pct === null ? null : Math.round(q.crowd_yes_pct), count: q.crowd_count, resolvedAt: q.resolved_at, voidReason: q.void_reason },
    reactions: d.reactions.filter((r) => r.question_id === q.id).map((r) => ({ member: r.member, text: r.text, createdAt: r.created_at })),
    lessons: d.lessons.filter((l) => l.question_id === q.id).map((l) => ({ member: l.member, text: l.text, createdAt: l.created_at })),
  });
}
