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

export const OPINION_PROMPT_VERSION = "opinion-v2";
// No question asked in the last 60 days (§4.1).
export const RECENT_DAYS = 60;
const MAX_CHARS = 120;
const SEARCH_USES = 8;
const REROLL_SEARCH_USES = 4;
const CATEGORIES = ["markets", "sports", "weather", "culture", "news"] as const;
type Category = (typeof CATEGORIES)[number];

export interface SeenOn { label: string; url: string | null }
export interface OpinionEntry { slot: number; category: Category; text: string; unhinged: boolean; seen_on: SeenOn | null }
export interface OpinionRoundResult { published: boolean; categories: string[]; texts: string[]; reason: string | null }

// A take is a statement (design 2026-09-25 N1): never a question, never
// prefaced with the label the card already carries.
const TextSchema = z.string().min(10).max(MAX_CHARS)
  .refine((t) => !/\?\s*$/.test(t), "a take is a statement, not a question: no question mark")
  .refine((t) => !t.includes("!"), "no exclamation marks")
  .refine((t) => !/^\s*(hot take|unpopular opinion)\b/i.test(t), "never open with 'hot take' or 'unpopular opinion'");

const SeenOnSchema = z.object({ label: z.string().min(1).max(80), url: z.string().url().nullable() }).nullable();
const EntrySchema = z.object({ slot: z.number().int().min(1).max(5), category: z.enum(CATEGORIES), text: TextSchema, unhinged: z.boolean(), seen_on: SeenOnSchema });

const OpinionSchema = z.object({ questions: z.array(EntrySchema).length(5) })
  .refine((v) => new Set(v.questions.map((q) => q.slot)).size === 5, "slots must be exactly 1..5")
  .refine((v) => new Set(v.questions.filter((q) => q.slot <= 4).map((q) => q.category)).size === 4, "slots 1 to 4 take four distinct categories")
  .refine((v) => v.questions.filter((q) => q.unhinged).length === 1, "exactly one take is unhinged");

const SingleSchema = z.object({ category: z.enum(CATEGORIES), text: TextSchema, seen_on: SeenOnSchema });

const seenOnJson = {
  type: ["object", "null"],
  properties: {
    label: { type: "string", description: "The community as people name it: r/AmItheAsshole, the replies, a group chat." },
    url: { type: ["string", "null"], description: "The thread, when search found one." },
  },
  required: ["label", "url"], additionalProperties: false,
};
const entryJson = {
  type: "object",
  properties: {
    slot: { type: "integer", minimum: 1, maximum: 5 },
    category: { type: "string", enum: [...CATEGORIES] },
    text: { type: "string", description: `The take: a statement a person would post, one sentence, at most ${MAX_CHARS} characters, no question mark.` },
    unhinged: { type: "boolean", description: "True on exactly one take: the absurd one people will still argue about." },
    seen_on: seenOnJson,
  },
  required: ["slot", "category", "text", "unhinged", "seen_on"], additionalProperties: false,
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
    text: { type: "string", description: `The take: a statement a person would post, one sentence, at most ${MAX_CHARS} characters, no question mark.` },
    seen_on: seenOnJson,
  },
  required: ["category", "text", "seen_on"], additionalProperties: false,
};

const RULES = `- Write like a person posting, not like a survey. A take is a statement, at most ${MAX_CHARS} characters, ending in a full stop or nothing, never a question mark. Lowercase is allowed. No hashtags, no emoji, no exclamation marks. Never open with "Hot take:" or "Unpopular opinion:"; the card already says that.
- No take about a death, a tragedy, a private individual, a named person's health, or anything derogatory. No take that asks the player to hope for harm. Politics is allowed as a subject, never as a side.
- Categories, read loosely: markets is money and work; sports is sports and games; weather is the outdoors and the seasons; culture is food, film, music and manners; news is society and public life.`;

const SEARCH = `Search first. Look at what is being argued on Reddit (r/unpopularopinion, r/AmItheAsshole, r/AskReddit, r/CasualConversation and the subreddit of whatever is in the news), on the day's trending topics, and in the comments under the day's viral posts. Prefer arguments from the last 48 hours. A take may be evergreen if the argument is live today. For each take, report where you saw it argued as seen_on; null when it came from the day's mood rather than one thread.`;

function systemPrompt(date: string, recent: string[]): string {
  const asked = recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n");
  return `You write the daily round for OUTSEE, a game where three AIs try to predict what the players think. The players are people who post. Find five things people are actually arguing about today, and write each as a hot take: a statement a person would post, that half the room will agree with and half will not, for the round dated ${date}.
${SEARCH}
- Slots 1 to 4 take one each of four different categories from markets, sports, weather, culture, news. Slot 5 is THE BIG ONE: the take everyone will have a view on, in any category.
- Exactly one of the five is unhinged: absurd on its face, and people will still argue about it ("cereal is a soup", "the airport is the best part of the trip"). Mark it with unhinged: true and no other.
${RULES}
- Do not post anything already posted in the last ${RECENT_DAYS} days:
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

type AskFiveResult = { ok: true; entries: OpinionEntry[] } | { ok: false; issue: string };

// A discriminated result, not a throw: a malformed response is an expected
// outcome buildOpinionDraft's retry loop handles, not a defect. Only
// BudgetExhausted escapes deps.claude.structured uncaught here — the same
// carve-out taste.ts and council/member.ts make around their own calls.
async function askFive(deps: PipelineDeps, date: string, recent: string[], refused: string[], validationIssue?: string): Promise<AskFiveResult> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const recentBlock = `Do not ask anything already asked in the last ${RECENT_DAYS} days:\n${recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n")}`;
  const refusedBlock = refused.length === 0
    ? ""
    : `\n\nThese were refused by the taste gate and must not be asked again, in any form:\n${refused.map((t) => `- ${t}`).join("\n")}`;
  const validationBlock = validationIssue === undefined
    ? ""
    : `\n\nYour previous set failed validation: ${validationIssue}. Write a corrected set.`;
  const user = `Write the five hot takes for ${date} now. ${recentBlock}${refusedBlock}${validationBlock}`;
  const response = await deps.claude.structured({
    model: deps.models.voice,
    system: systemPrompt(date, recent),
    user,
    schemaName: "opinion_round",
    schema: opinionJsonSchema,
    effort: "low",
    webSearch: { maxUses: SEARCH_USES },
  });
  const parsed = OpinionSchema.safeParse(response);
  if (!parsed.success) return { ok: false, issue: parsed.error.issues[0]?.message ?? "unknown" };
  return { ok: true, entries: [...parsed.data.questions].sort((a, b) => a.slot - b.slot) };
}

export function toOpinionDraft(deps: PipelineDeps, date: string, entries: OpinionEntry[]): Draft {
  const locksAt = noonET(addDays(date, 1)).toISOString();
  return DraftSchema.parse({
    questions: entries.map((e) => ({
      slot: e.slot,
      category: e.category,
      text: e.text,
      seen_on: e.seen_on,
      unhinged: e.unhinged,
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
  let validationIssue: string | undefined;
  // The taste-refusal attempt counter and the validation retry share this
  // loop: two failures of either kind, in any combination, end the night at
  // two voice calls total.
  for (let attempt = 0; attempt < 2; attempt++) {
    const asked = await askFive(deps, date, recent, refused, validationIssue);
    if (!asked.ok) {
      if (attempt === 1) return { draft: null, reason: `the voice's questions failed validation twice: ${asked.issue}` };
      validationIssue = asked.issue;
      continue;
    }
    validationIssue = undefined;
    const entries = asked.entries;
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
  return { published: true, categories: qs.map((q) => q.category), texts: qs.map((q) => `${q.slot}. [${q.category}]${q.unhinged ? " [UNHINGED]" : ""} ${q.text}${q.seen_on ? ` · seen on ${q.seen_on.label}` : ""}`), reason: null };
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
  const system = `You write one replacement hot take for OUTSEE's round dated ${date}, slot ${slot}${isBigOne ? " (THE BIG ONE: the take everyone will have a view on, in any category)" : ` (category: ${target.category})`}. The players are people who post. A hot take is a statement a person would post, that half the room will agree with and half will not.
${SEARCH}
${RULES}
${target.unhinged ? "- This slot is THE UNHINGED ONE: absurd on its face, and people will still argue about it. Keep it that way.\n" : ""}${isBigOne ? "" : `- Keep the category ${target.category}.\n`}- Do not overlap these takes already in the round:\n${others.map((q) => `- [${q.category}] ${q.text}`).join("\n")}
- Do not post anything already posted in the last ${RECENT_DAYS} days:\n${recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n")}
Operator guidance: ${guidance || "none"}
Call the opinion_question tool exactly once.`;
  const response = await deps.claude.structured({
    model: deps.models.voice, system, user: `Write the replacement for slot ${slot} now.`,
    schemaName: "opinion_question", schema: singleJsonSchema, effort: "low", webSearch: { maxUses: REROLL_SEARCH_USES },
  });
  const parsed = SingleSchema.safeParse(response);
  if (!parsed.success) throw new Error(`reroll: response failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  const category = isBigOne ? parsed.data.category : target.category;
  const taste = await tasteTexts(deps, [parsed.data.text]);
  if (taste.detail !== null) throw new Error(`reroll: ${taste.detail}`);
  if (!taste.allowed[0]) throw new Error(`reroll: the taste gate refused the replacement${taste.reasons[0] ? ` (${taste.reasons[0]})` : ""}`);

  const stillScheduled = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, slot)) });
  if (!stillScheduled || stillScheduled.status !== "scheduled") throw new Error(`draft already published for ${date}`);
  // The slot's own unhinged flag is kept (a reroll of the unhinged take stays
  // the unhinged take); no reroll can create a second one (§4.4).
  await deps.db.update(schema.questions)
    .set({ text: parsed.data.text, category, context: null, seenOnLabel: parsed.data.seen_on?.label ?? null, seenOnUrl: parsed.data.seen_on?.url ?? null })
    .where(and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, slot), eq(schema.questions.status, "scheduled")));

  const updated = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const sorted = [...updated].sort((a, b) => a.slot - b.slot);
  await deps.telegram.send(draftMessage(date, sorted.map((row) => ({
    slot: row.slot, category: row.category, text: row.text, resolution_criteria: row.resolutionCriteria, is_big_one: row.isBigOne, resolves_at: null,
  }))));
  // draftMessage's shared signature (author.ts) has no room for seen_on or
  // unhinged, so the reroll's provenance follows as its own line.
  await deps.telegram.send(
    `provenance: ${sorted.map((row) => `${row.slot}. ${row.unhinged ? "[UNHINGED] " : ""}${row.seenOnLabel ? `seen on ${row.seenOnLabel}` : "—"}`).join(" · ")}`,
  );
}
