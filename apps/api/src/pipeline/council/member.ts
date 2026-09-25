// One member's lines on the five questions (design 2026-09-11 §6): one
// structured call over the shared pack, no search tool, an abstention as a
// VALUE rather than an error so a Workflow step can return it and the commit
// step can take the median of whoever is present. Only BudgetExhausted
// escapes, as it does from resolveOne.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { MEMBER_PROFILE, MODEL_MEMBER_IDS, type ModelMemberId } from "@oracle/core";
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

// A crowd round asks a member to read the room, not the evidence (design
// 2026-09-22 §6): the market schema's `reasoning` invites a citation trail
// that does not exist here, and its `cited` description tells the member to
// cite evidence it was never given. Byte-identical otherwise.
export const crowdCouncilJsonSchema = {
  type: "object",
  properties: {
    lines: {
      type: "array", minItems: 5, maxItems: 5,
      items: {
        type: "object",
        properties: {
          slot: { type: "integer", minimum: 1, maximum: 5 },
          p_yes: { type: "number", minimum: P_MIN, maximum: P_MAX, description: "Your probability that the answer is YES." },
          reasoning: { type: "string", description: "Two to five plain sentences on why the room will lean the way you say. Shown to players as written." },
          cited: { type: "array", items: { type: "integer", minimum: 1 }, description: "Always empty on an opinion question; there is nothing to cite." },
        },
        required: ["slot", "p_yes", "reasoning", "cited"], additionalProperties: false,
      },
    },
  },
  required: ["lines"], additionalProperties: false,
};

// Reasoning caps per member (design 2026-09-25 §5.2): the register is a
// length as much as a voice. Over the cap the slot abstains, as a bad p_yes does.
export const REASONING_CAP: Record<ModelMemberId, number> = { haiku: 200, sonnet: 500, opus: 800 };

const REASONING_ASK: Record<ModelMemberId, string> = {
  haiku: "one or two lines, lowercase, no punctuation beyond a full stop, no hedging",
  sonnet: "two to four plain sentences",
  opus: "three to six sentences, and you may refer to your own earlier calls by name",
};

export function crowdCouncilJsonSchemaFor(member: ModelMemberId) {
  const base = crowdCouncilJsonSchema as { properties: { lines: { items: { properties: { reasoning: Record<string, unknown> } } } } };
  return {
    ...crowdCouncilJsonSchema,
    properties: {
      lines: {
        ...base.properties.lines,
        items: {
          ...base.properties.lines.items,
          properties: {
            ...base.properties.lines.items.properties,
            reasoning: { ...base.properties.lines.items.properties.reasoning, maxLength: REASONING_CAP[member], description: `Why the room will lean the way you say: ${REASONING_ASK[member]}. Shown to players as written, in #nightshift.` },
          },
        },
      },
    },
  };
}

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

function crowdSystemPrompt(date: string, now: Date, member: ModelMemberId): string {
  const me = MEMBER_PROFILE[member];
  const others = MODEL_MEMBER_IDS.filter((m) => m !== member).map((m) => `${MEMBER_PROFILE[m].name} (${MEMBER_PROFILE[m].title})`).join(" and ");
  return `You are ${me.name}, ${me.title} on THE ORACLE's Council. ${me.register} You post in #nightshift, the Council's channel, which players read after they seal. Your co-workers are ${others}.

The round dated ${date} opens at noon ET and locks at noon ET the following day. It is now ${now.toISOString()}.

- Each take is a statement. Players answer YES (agree) or NO (disagree) from their own view. Estimate the share of players who will answer YES, between ${P_MIN} and ${P_MAX}. Exactly 0.5 is valid when you expect an even room.
- The players are people who post. They are online more than is good for them, they have opinions about everything, and they answer from the gut. Weigh what people say when asked, not what they believe privately.
- Your reasoning is ${REASONING_ASK[member]}. It will be shown to players as written.
- Where lessons from your own earlier calls are given, weigh them; they are yours.
- Leave cited empty; there is nothing to cite.

Call the council_lines tool exactly once with exactly one entry for each slot 1 through 5.`;
}

function crowdQuestionBlock(q: { slot: number; isBigOne: boolean; text: string }, lessons: LessonReceived[]): string {
  const head = `[slot ${q.slot}${q.isBigOne ? " · THE BIG ONE" : ""}] ${q.text}`;
  const mem = lessons.length === 0 ? "" : `\nWHAT YOU LEARNED BEFORE:\n${lessons.map((l) => `(${l.seriesKey}, settled ${fmtDate(l.resolvedAt)}) ${l.text}`).join("\n")}`;
  return `${head}${mem}`;
}

export async function commitMember(deps: PipelineDeps, date: string, member: ModelMemberId): Promise<MemberResult> {
  const qs = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, isBigOne: true, text: true, resolutionCriteria: true, marketProb: true, marketSeriesKey: true, category: true, marketSource: true },
  });
  const allSlots = qs.map((q) => q.slot);
  const abstainAll = (error: string): MemberResult => ({ member, lines: [], abstained: allSlots, error });
  if (qs.length !== 5) return abstainAll("five questions required");
  if (!deps.claude) return abstainAll("no claude client");

  const crowd = qs.every((q) => q.marketSource === "crowd");
  const now = deps.now();
  const packRows = crowd ? [] : await deps.db.query.evidence.findMany({ where: inArray(schema.evidence.questionId, qs.map((q) => q.id)), orderBy: (e, { asc }) => [asc(e.rank)] });
  const packs = new Map(qs.map((q) => [q.id, packRows.filter((e) => e.questionId === q.id)]));
  const received = new Map<string, LessonReceived[]>();
  for (const q of qs) received.set(q.id, await lessonsFor(deps.db, member, seriesKeyOf(q), now));

  const user = crowd
    ? qs.map((q) => crowdQuestionBlock(q, received.get(q.id)!)).join("\n\n")
    : qs.map((q) => questionBlock(q, packs.get(q.id)!, received.get(q.id)!)).join("\n\n");
  let response: unknown;
  try {
    response = await deps.claude.structured({
      model: memberModel(deps, member),
      system: crowd ? crowdSystemPrompt(date, now, member) : systemPrompt(date, now),
      user,
      schemaName: "council_lines",
      schema: crowd ? crowdCouncilJsonSchemaFor(member) : councilJsonSchema,
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
    if (crowd && e.data.reasoning.length > REASONING_CAP[member]) continue;
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
