// The Council on the reveal (design 2026-09-11 §15): the split under each
// card's line, and the reading beneath a member's row. Pure; the screen
// only renders what these return.
import { MEMBER_ORDER, type CouncilEntry, type EvidenceItem, type Reveal } from "@oracle/core";

export type SplitTone = "win" | "loss" | "mute";
export interface SplitRow { member: CouncilEntry["member"] | "line"; label: string; tone: SplitTone }

// No longer read by CouncilReading's closed label (final review finding 5:
// the label became "<MEMBER>'S READING" to fit iPhone width) — kept as an
// export in case another surface still wants "the reading" phrased generically.
export const READING_LINK = "THE ORACLE'S READING";
// One meta row of machine voice; the slot reserves rows × this when it has rows.
export const SPLIT_ROW_H = 15;

const NAMES: Record<CouncilEntry["member"], string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku", market: "the market" };

export function memberName(m: CouncilEntry["member"]): string {
  return NAMES[m];
}

export function councilFor(d: Reveal, questionId: string): CouncilEntry[] {
  return d.council
    .filter((e) => e.question_id === questionId)
    .sort((a, b) => MEMBER_ORDER.indexOf(a.member) - MEMBER_ORDER.indexOf(b.member));
}

export function evidenceFor(d: Reveal, questionId: string): EvidenceItem[] {
  return d.evidence.filter((e) => e.question_id === questionId).sort((a, b) => a.rank - b.rank);
}

const pct = (p: number) => String(Math.round(p * 100));

export function splitRows(entries: CouncilEntry[], linePYes: number | null): SplitRow[] {
  if (entries.length === 0) return [];
  const rows: SplitRow[] = entries.map((e) => ({
    member: e.member,
    label: `${e.member.toUpperCase()} ${pct(e.p_yes)}`,
    tone: e.on_right_side === null ? "mute" : e.on_right_side ? "win" : "loss",
  }));
  if (linePYes !== null) rows.push({ member: "line", label: `THE ORACLE'S LINE ${pct(linePYes)}`, tone: "mute" });
  return rows;
}

export function readingFor(entry: CouncilEntry, pack: EvidenceItem[]): { paragraph: string; cited: EvidenceItem[]; alsoRead: EvidenceItem[] } | null {
  if (entry.member === "market") return null;
  const paragraph = (entry.reasoning ?? "").trim();
  if (!paragraph) return null;
  const cited = new Set(entry.cited);
  const sorted = [...pack].sort((a, b) => a.rank - b.rank);
  return { paragraph, cited: sorted.filter((i) => cited.has(i.rank)), alsoRead: sorted.filter((i) => !cited.has(i.rank)) };
}
