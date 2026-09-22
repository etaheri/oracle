// The opinion round (design 2026-09-22 §4): one voice call writes five hot
// takes, the taste gate screens them, and the draft commits as five crowd
// questions — version 3 rows whose market_source is "crowd", so every
// reader, board and settlement path renders them unchanged (T1, T2). No
// exchange fetch, no context, no evidence: an opinion has nothing to look
// up, and the five Exa searches were the night's cost.
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "../db/client";
import type { PipelineDeps } from "./index";
import { addDays, noonET } from "./clock";
import { CROWD_RESOLUTION_CRITERIA, DraftSchema, RESOLVES_AFTER_LOCK, upsertDraft, type Draft } from "./draft";
import { tasteTexts } from "./taste";
import { siteUrlOf } from "./round-kind";
import { draftMessage } from "./author";

export const OPINION_PROMPT_VERSION = "opinion-v1";
// No question asked in the last 60 days (§4.1).
export const RECENT_DAYS = 60;
const MAX_CHARS = 120;
const CATEGORIES = ["markets", "sports", "weather", "culture", "news"] as const;
type Category = (typeof CATEGORIES)[number];

export interface OpinionEntry { slot: number; category: Category; text: string }
export interface OpinionRoundResult { published: boolean; categories: string[]; texts: string[]; reason: string | null }

const TextSchema = z.string().min(10).max(MAX_CHARS)
  .regex(/\?$/, "a question ends with a question mark")
  .refine((t) => !t.includes("!"), "no exclamation marks")
  .refine((t) => !/^\s*do you think\b/i.test(t), "no leading 'Do you think'");

const EntrySchema = z.object({ slot: z.number().int().min(1).max(5), category: z.enum(CATEGORIES), text: TextSchema });

const OpinionSchema = z.object({ questions: z.array(EntrySchema).length(5) })
  .refine((v) => new Set(v.questions.map((q) => q.slot)).size === 5, "slots must be exactly 1..5")
  .refine((v) => new Set(v.questions.filter((q) => q.slot <= 4).map((q) => q.category)).size === 4, "slots 1 to 4 take four distinct categories");

const SingleSchema = z.object({ category: z.enum(CATEGORIES), text: TextSchema });

const entryJson = {
  type: "object",
  properties: {
    slot: { type: "integer", minimum: 1, maximum: 5 },
    category: { type: "string", enum: [...CATEGORIES] },
    text: { type: "string", description: `The question, plain English, one sentence, ending in a question mark, at most ${MAX_CHARS} characters.` },
  },
  required: ["slot", "category", "text"], additionalProperties: false,
};
const opinionJsonSchema = {
  type: "object",
  properties: { questions: { type: "array", minItems: 5, maxItems: 5, items: entryJson } },
  required: ["questions"], additionalProperties: false,
};
const singleJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    text: { type: "string", description: `The question, plain English, one sentence, ending in a question mark, at most ${MAX_CHARS} characters.` },
  },
  required: ["category", "text"], additionalProperties: false,
};

const RULES = `- Plain words, at most ${MAX_CHARS} characters, ending in a question mark. No exclamation marks. Never open with "Do you think".
- No question about a death, a tragedy, a private individual, a named person's health, or anything derogatory. No question that asks the player to hope for harm. Politics is allowed as a subject, never as a side.
- Categories, read loosely: markets is money and work; sports is sports and games; weather is the outdoors and the seasons; culture is food, film, music and manners; news is society and public life.`;

function systemPrompt(date: string, recent: string[]): string {
  const asked = recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n");
  return `You write the daily round for ORACLE, a game where three AIs try to predict what the players think. Write five yes-or-no opinion questions for a general US audience for the round dated ${date}. People argue about them at dinner; no fact settles them; a person would want to know which way the room went.
- Slots 1 to 4 take one each of four different categories from markets, sports, weather, culture, news. Slot 5 is THE BIG ONE: the one everyone will have an opinion on, in any category.
${RULES}
- Do not ask anything already asked in the last ${RECENT_DAYS} days:
${asked}
Call the opinion_round tool exactly once with one entry per slot 1 through 5.`;
}

export async function recentCrowdTexts(db: Db, date: string): Promise<string[]> {
  const rows = await db.query.questions.findMany({
    where: and(eq(schema.questions.marketSource, "crowd"), gte(schema.questions.roundDate, addDays(date, -RECENT_DAYS))),
    columns: { text: true },
  });
  return rows.map((r) => r.text);
}

async function askFive(deps: PipelineDeps, date: string, recent: string[], refused: string[]): Promise<OpinionEntry[]> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const recentBlock = `Do not ask anything already asked in the last ${RECENT_DAYS} days:\n${recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n")}`;
  const refusedBlock = refused.length === 0
    ? ""
    : `\n\nThese were refused by the taste gate and must not be asked again, in any form:\n${refused.map((t) => `- ${t}`).join("\n")}`;
  const user = `Write the five hot takes for ${date} now. ${recentBlock}${refusedBlock}`;
  const response = await deps.claude.structured({
    model: deps.models.voice,
    system: systemPrompt(date, recent),
    user,
    schemaName: "opinion_round",
    schema: opinionJsonSchema,
    effort: "low",
  });
  const parsed = OpinionSchema.safeParse(response);
  if (!parsed.success) throw new Error(`opinion: response failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return [...parsed.data.questions].sort((a, b) => a.slot - b.slot);
}

export function toOpinionDraft(deps: PipelineDeps, date: string, entries: OpinionEntry[]): Draft {
  const locksAt = noonET(addDays(date, 1)).toISOString();
  return DraftSchema.parse({
    questions: entries.map((e) => ({
      slot: e.slot,
      category: e.category,
      text: e.text,
      resolution_criteria: CROWD_RESOLUTION_CRITERIA,
      source_name: "THE PLAYERS",
      source_url: `${siteUrlOf(deps)}/play`,
      author_probability: 0.5,
      is_big_one: e.slot === 5,
      market_prob: null,
      resolves_at: RESOLVES_AFTER_LOCK,
      market: { source: "crowd", id: date, event_key: String(e.slot), closes_at: locksAt },
    })),
  });
}

export async function buildOpinionDraft(deps: PipelineDeps, date: string): Promise<{ draft: Draft | null; reason: string | null }> {
  const recent = await recentCrowdTexts(deps.db, date);
  let refused: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const entries = await askFive(deps, date, recent, refused);
    const taste = await tasteTexts(deps, entries.map((e) => e.text));
    if (taste.detail !== null) return { draft: null, reason: taste.detail };
    const bad = entries.filter((_, i) => !taste.allowed[i]).map((e) => e.text);
    if (bad.length === 0) return { draft: toOpinionDraft(deps, date, entries), reason: null };
    refused = [...refused, ...bad];
  }
  return { draft: null, reason: "the taste gate refused a question on both passes" };
}

export async function commitOpinionDraft(deps: PipelineDeps, date: string, draft: Draft): Promise<void> {
  await upsertDraft(deps.db, date, draft, 3);
}

export function opinionResult(draft: Draft | null, reason: string | null): OpinionRoundResult {
  if (!draft) return { published: false, categories: [], texts: [], reason };
  const qs = [...draft.questions].sort((a, b) => a.slot - b.slot);
  return { published: true, categories: qs.map((q) => q.category), texts: qs.map((q) => `${q.slot}. [${q.category}] ${q.text}`), reason: null };
}

export async function narrateOpinionRound(deps: PipelineDeps, date: string, r: OpinionRoundResult): Promise<void> {
  if (r.published) {
    await deps.telegram.send([`${date}: opinion round authored · 5 questions · categories ${r.categories.join(", ")}`, ...r.texts].join("\n"));
  } else {
    await deps.telegram.send(`⚠ ${date}: no opinion round — ${r.reason ?? "unknown"}; the bank covers noon`);
  }
}

export async function runOpinionRound(deps: PipelineDeps, date: string): Promise<OpinionRoundResult> {
  const existing = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (existing && (existing.status !== "scheduled" || existing.oracleCommittedAt !== null)) {
    return { published: false, categories: [], texts: [], reason: "round not editable" };
  }
  const { draft, reason } = await buildOpinionDraft(deps, date);
  if (draft) await commitOpinionDraft(deps, date, draft);
  const result = opinionResult(draft, reason);
  await narrateOpinionRound(deps, date, result);
  return result;
}

// /reroll for a crowd slot (design 2026-09-22 §13 step 2): one voice call
// for one replacement in the slot's own category (any category for THE BIG
// ONE), through the taste gate, written onto the scheduled row. The crowd
// columns are untouched: the market is the round date and the slot, and a
// reroll changes neither.
export async function rerollOpinionSlot(deps: PipelineDeps, date: string, slot: number, guidance: string): Promise<void> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const questions = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const target = questions.find((q) => q.slot === slot);
  if (!target || target.status !== "scheduled") throw new Error(`draft already published for ${date}`);
  const others = questions.filter((q) => q.slot !== slot).sort((a, b) => a.slot - b.slot);
  const recent = await recentCrowdTexts(deps.db, date);
  const isBigOne = slot === 5;
  const system = `You write one replacement hot take for ORACLE's round dated ${date}, slot ${slot}${isBigOne ? " (THE BIG ONE: the one everyone will have an opinion on, in any category)" : ` (category: ${target.category})`}. It is a yes-or-no opinion question for a general US audience; people argue about it at dinner; no fact settles it.
${RULES}
${isBigOne ? "" : `- Keep the category ${target.category}.\n`}- Do not overlap these questions already in the round:\n${others.map((q) => `- [${q.category}] ${q.text}`).join("\n")}
- Do not ask anything already asked in the last ${RECENT_DAYS} days:\n${recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n")}
Operator guidance: ${guidance || "none"}
Call the opinion_question tool exactly once.`;
  const response = await deps.claude.structured({
    model: deps.models.voice, system, user: `Write the replacement for slot ${slot} now.`,
    schemaName: "opinion_question", schema: singleJsonSchema, effort: "low",
  });
  const parsed = SingleSchema.safeParse(response);
  if (!parsed.success) throw new Error(`reroll: response failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  const category = isBigOne ? parsed.data.category : target.category;
  const taste = await tasteTexts(deps, [parsed.data.text]);
  if (taste.detail !== null) throw new Error(`reroll: ${taste.detail}`);
  if (!taste.allowed[0]) throw new Error(`reroll: the taste gate refused the replacement${taste.reasons[0] ? ` (${taste.reasons[0]})` : ""}`);

  const stillScheduled = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, slot)) });
  if (!stillScheduled || stillScheduled.status !== "scheduled") throw new Error(`draft already published for ${date}`);
  await deps.db.update(schema.questions)
    .set({ text: parsed.data.text, category, context: null })
    .where(and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, slot), eq(schema.questions.status, "scheduled")));

  const updated = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  await deps.telegram.send(draftMessage(date, [...updated].sort((a, b) => a.slot - b.slot).map((row) => ({
    slot: row.slot, category: row.category, text: row.text, resolution_criteria: row.resolutionCriteria, is_big_one: row.isBigOne, resolves_at: null,
  }))));
}
