// One member's lines on the five questions (design 2026-09-11 §6): one
// structured call over the shared pack, no search tool, an abstention as a
// VALUE rather than an error so a Workflow step can return it and the commit
// step can take the median of whoever is present. Only BudgetExhausted
// escapes, as it does from resolveOne.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ModelMemberId } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { BudgetExhausted } from "../spend";
import { memberModel } from "./members";
import { lessonsFor, seriesKeyOf, type LessonReceived } from "./lessonsFor";

export interface MemberLine { slot: number; questionId: string; pYes: number; reasoning: string; cited: number[]; lessonsReceived: string[] }
export interface MemberResult { member: ModelMemberId; lines: MemberLine[]; abstained: number[]; error?: string }

const P_MIN = 0.05;
const P_MAX = 0.95;

// Lenient on purpose: one bad entry abstains that slot, not the member.
const EntrySchema = z.object({ slot: z.number().int(), p_yes: z.number(), reasoning: z.string(), cited: z.array(z.number().int()).default([]) });
const OutputSchema = z.object({ lines: z.array(z.unknown()) });

export const councilJsonSchema = {
  type: "object",
  properties: {
    lines: {
      type: "array", minItems: 5, maxItems: 5,
      items: {
        type: "object",
        properties: {
          slot: { type: "integer", minimum: 1, maximum: 5 },
          p_yes: { type: "number", minimum: P_MIN, maximum: P_MAX, description: "Your probability that the answer is YES." },
          reasoning: { type: "string", description: "Two to five plain sentences: the route from the evidence to your number. Cite evidence by its number in square brackets." },
          cited: { type: "array", items: { type: "integer", minimum: 1 }, description: "The evidence numbers you relied on, from this question's list only." },
        },
        required: ["slot", "p_yes", "reasoning", "cited"], additionalProperties: false,
      },
    },
  },
  required: ["lines"], additionalProperties: false,
};

function systemPrompt(date: string, now: Date): string {
  return `You are one voice of THE ORACLE's Council. You are preparing the round dated ${date}, before it opens at noon ET; it locks at noon ET the following day. It is now ${now.toISOString()}.

- Forecast; do not resolve. Use only the evidence listed under each question, and cite it by number. You have no other tools.
- Report your best-supported probability of YES between ${P_MIN} and ${P_MAX}. Exactly 0.5 is valid when the evidence supports equal chances. A proper scoring rule rewards an honest expression of your uncertainty; do not exaggerate confidence or hedge for appearances.
- The market's price is context, not an answer. Disagree with it when the evidence warrants.
- Your reasoning is the route from the evidence to your number, in two to five plain sentences. It is not a transcript of your thinking and will be shown to players as written.
- Where lessons from your own earlier calls are given, weigh them; they are yours.

Call the council_lines tool exactly once with exactly one entry for each slot 1 through 5.`;
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "undated";
}

function questionBlock(q: { slot: number; isBigOne: boolean; text: string; resolutionCriteria: string; marketProb: string | null }, pack: { rank: number; title: string; source: string; publishedAt: Date | null; highlight: string }[], lessons: LessonReceived[]): string {
  const head = `[slot ${q.slot}${q.isBigOne ? " · THE BIG ONE" : ""}] ${q.text}\nRESOLVES BY: ${q.resolutionCriteria}\nTHE MARKET'S PRICE: ${q.marketProb === null ? "unknown" : `${Math.round(Number(q.marketProb) * 100)}% YES`}`;
  const ev = pack.length === 0
    ? "EVIDENCE: No evidence was retrieved for this question."
    : `EVIDENCE:\n${pack.map((e) => `[${e.rank}] ${e.title} — ${e.source}, ${fmtDate(e.publishedAt)}: ${e.highlight}`).join("\n")}`;
  const mem = lessons.length === 0 ? "" : `\nWHAT YOU LEARNED BEFORE:\n${lessons.map((l) => `(${l.seriesKey}, settled ${fmtDate(l.resolvedAt)}) ${l.text}`).join("\n")}`;
  return `${head}\n${ev}${mem}`;
}

export async function commitMember(deps: PipelineDeps, date: string, member: ModelMemberId): Promise<MemberResult> {
  const qs = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, isBigOne: true, text: true, resolutionCriteria: true, marketProb: true, marketSeriesKey: true, category: true },
  });
  const allSlots = qs.map((q) => q.slot);
  const abstainAll = (error: string): MemberResult => ({ member, lines: [], abstained: allSlots, error });
  if (qs.length !== 5) return abstainAll("five questions required");
  if (!deps.claude) return abstainAll("no claude client");

  const now = deps.now();
  const packRows = await deps.db.query.evidence.findMany({ where: inArray(schema.evidence.questionId, qs.map((q) => q.id)), orderBy: (e, { asc }) => [asc(e.rank)] });
  const packs = new Map(qs.map((q) => [q.id, packRows.filter((e) => e.questionId === q.id)]));
  const received = new Map<string, LessonReceived[]>();
  for (const q of qs) received.set(q.id, await lessonsFor(deps.db, member, seriesKeyOf(q), now));

  const user = qs.map((q) => questionBlock(q, packs.get(q.id)!, received.get(q.id)!)).join("\n\n");
  let response: unknown;
  try {
    response = await deps.claude.structured({
      model: memberModel(deps, member),
      system: systemPrompt(date, now),
      user,
      schemaName: "council_lines",
      schema: councilJsonSchema,
    });
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return abstainAll(err instanceof Error ? err.message : String(err));
  }
  const parsed = OutputSchema.safeParse(response);
  if (!parsed.success) return abstainAll("response failed the council_lines schema");

  const lines: MemberLine[] = [];
  for (const raw of parsed.data.lines) {
    const e = EntrySchema.safeParse(raw);
    if (!e.success) continue;
    const q = qs.find((x) => x.slot === e.data.slot);
    if (!q || e.data.p_yes < P_MIN || e.data.p_yes > P_MAX) continue;
    if (lines.some((l) => l.slot === q.slot)) continue;
    const ranks = new Set(packs.get(q.id)!.map((x) => x.rank));
    lines.push({
      slot: q.slot,
      questionId: q.id,
      pYes: e.data.p_yes,
      reasoning: e.data.reasoning.trim(),
      cited: [...new Set(e.data.cited.filter((r) => ranks.has(r)))].sort((a, b) => a - b),
      lessonsReceived: received.get(q.id)!.map((l) => l.id),
    });
  }
  lines.sort((a, b) => a.slot - b.slot);
  const abstained = allSlots.filter((s) => !lines.some((l) => l.slot === s));
  return { member, lines, abstained };
}
