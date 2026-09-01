// Hermes authoring (spec §5): Claude drafts the daily round, we validate it
// with one retry, persist it as `scheduled` rows, and narrate the draft to
// Telegram. Also carries the operator's single-slot reroll flow.
import { and, eq, gte, lt } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import type { PipelineDeps } from "./index";
import { DraftSchema, DraftQuestionSchema, lockFromResolvesAt, type Draft } from "./draft";
import { upsertDraft } from "./draft";
import { addDays, noonET } from "./clock";
import { fetchMarketSignals, type MarketSignal } from "./feeds";

const CATEGORIES = ["markets", "sports", "weather", "culture", "news"] as const;

const draftQuestionProperties = {
  slot: { type: "integer", minimum: 1, maximum: 5 },
  category: { type: "string", enum: [...CATEGORIES] },
  text: { type: "string", minLength: 10 },
  resolution_criteria: { type: "string", minLength: 10 },
  source_name: { type: "string", minLength: 1 },
  source_url: { type: "string", format: "uri" },
  author_probability: { type: "number", minimum: 0.3, maximum: 0.7 },
  is_big_one: { type: "boolean" },
  market_prob: { type: ["number", "null"], minimum: 0, maximum: 1 },
  locks_at: { type: ["string", "null"] },
};

const draftQuestionRequired = [
  "slot",
  "category",
  "text",
  "resolution_criteria",
  "source_name",
  "source_url",
  "author_probability",
  "is_big_one",
  "market_prob",
  "locks_at",
];

const draftQuestionJsonSchema = {
  type: "object",
  properties: draftQuestionProperties,
  required: draftQuestionRequired,
  additionalProperties: false,
};

const draftRoundJsonSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: draftQuestionJsonSchema,
      minItems: 5,
      maxItems: 5,
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

function marketSignalsBlock(signals: MarketSignal[]): string {
  if (signals.length === 0) return "";
  const lines = signals.map(
    (s) => `- [${s.source}] "${s.question}" — ${Math.round(s.prob * 100)}% YES — closes ${s.closesAt}`,
  );
  return `
LIVE MARKET SIGNALS — real prediction markets closing within 36 hours. These are contested by actual bettors:
${lines.join("\n")}
- Prefer adapting market-backed candidates where they fit the category skeleton, especially THE BIG ONE.
- When a question is adapted from a listed market, set market_prob to that market's probability (0-1); otherwise set market_prob to null.
- NEVER cite a prediction market as the resolution source — resolution always names a primary public source.`;
}

function authorSystemPrompt(date: string, recentTexts: string, signals: MarketSignal[]): string {
  return `You author the daily round for ORACLE, a prediction game. Produce exactly 5 yes/no questions for the round dated ${date} (ET). Rules:
- Slots 1-4: four different categories from markets, sports, weather, culture, news. Slot 5 is THE BIG ONE: the day's most contested story from any category.
- Each question must be binary YES/NO in plain English, resolvable by 11:00 AM ET on ${addDays(date, 1)} from ONE named public source.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. No gimmes.
- resolution_criteria must name the exact measurement, the exact source page, and the deadline. Zero ambiguity: a stranger must be able to resolve it identically.
- locks_at: if the outcome begins to become knowable before 11:00 AM ET on ${addDays(date, 1)} (a game tips off, a market closes, a scheduled release lands), set locks_at to that moment as an ISO-8601 UTC timestamp so answers lock before the information leaks. Otherwise null.
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine.
- Avoid repeating these recent questions: ${recentTexts}${marketSignalsBlock(signals)}
Search the web for today's actual news before writing. When your draft is final, call the draft_round tool exactly once.`;
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message))
    .join("; ");
}

async function recentQuestionTexts(db: Db, date: string): Promise<string> {
  const since = addDays(date, -7);
  const rows = await db.query.questions.findMany({
    where: and(gte(schema.questions.roundDate, since), lt(schema.questions.roundDate, date)),
  });
  const texts = rows.map((r) => r.text);
  return texts.length ? texts.join("; ") : "(none)";
}

export async function authorRound(deps: PipelineDeps, date: string): Promise<void> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const claude = deps.claude;

  const recentTexts = await recentQuestionTexts(deps.db, date);
  // Market feeds are advisory: any failure logs inside fetchMarketSignals and
  // authoring proceeds market-blind on an empty list.
  const { signals } = await fetchMarketSignals(deps.marketFetch ?? fetch, deps.now());
  const system = authorSystemPrompt(date, recentTexts, signals);
  const baseUser = `Produce today's ORACLE round for ${date}.`;

  const first = await claude.structured({
    model: deps.models.author,
    system,
    user: baseUser,
    schemaName: "draft_round",
    schema: draftRoundJsonSchema,
    webSearch: { maxUses: 8 },
  });

  let parsed = DraftSchema.safeParse(first);
  if (!parsed.success) {
    const issues = formatIssues(parsed.error.issues);
    const retryUser = `${baseUser}\n\nYour previous draft failed validation: ${issues}. Produce a corrected draft.`;
    const second = await claude.structured({
      model: deps.models.author,
      system,
      user: retryUser,
      schemaName: "draft_round",
      schema: draftRoundJsonSchema,
      webSearch: { maxUses: 8 },
    });
    parsed = DraftSchema.safeParse(second);
    if (!parsed.success) {
      throw new Error(`author: draft failed validation twice: ${formatIssues(parsed.error.issues)}`);
    }
  }

  const draft: Draft = parsed.data;
  await upsertDraft(deps.db, date, draft);
  await deps.telegram.send(draftMessage(date, draft.questions));
}

function rerollSystemPrompt(date: string, slot: number, othersTexts: string, guidance: string): string {
  const isBigOne = slot === 5;
  return `You author a single replacement question for the ORACLE round dated ${date} (ET), slot ${slot}${isBigOne ? " (THE BIG ONE)" : ""}. Rules:
- The question must be binary YES/NO in plain English, resolvable by 11:00 AM ET on ${addDays(date, 1)} from ONE named public source.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. No gimmes.
- resolution_criteria must name the exact measurement, the exact source page, and the deadline. Zero ambiguity: a stranger must be able to resolve it identically.
- locks_at: if the outcome begins to become knowable before 11:00 AM ET on ${addDays(date, 1)} (a game tips off, a market closes, a scheduled release lands), set locks_at to that moment as an ISO-8601 UTC timestamp so answers lock before the information leaks. Otherwise null.
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine.
${isBigOne ? "- This is THE BIG ONE: pick the day's most contested story from any category." : "- Pick a category different from the other four questions below."}
Do not overlap these existing questions: ${othersTexts}
Operator guidance: ${guidance}
Search the web for today's actual news before writing. When your draft is final, call the draft_question tool exactly once.`;
}

export async function rerollSlot(deps: PipelineDeps, date: string, slot: number, guidance: string): Promise<void> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const claude = deps.claude;

  const questions = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  if (questions.length === 0) throw new Error(`no draft for ${date}`);

  // A reroll that lands after publish must never mutate a live open round's
  // question — re-check right before we touch anything (not just at the top
  // of the handler) so this stays correct even though we do a slow Claude
  // call in between.
  const target = questions.find((q) => q.slot === slot);
  if (!target || target.status !== "scheduled") {
    throw new Error(`draft already published for ${date}`);
  }

  const others = questions.filter((q) => q.slot !== slot).sort((a, b) => a.slot - b.slot);
  const othersTexts = others.map((q) => `[${q.category}] ${q.text}`).join("; ");

  const response = await claude.structured({
    model: deps.models.author,
    system: rerollSystemPrompt(date, slot, othersTexts, guidance),
    user: `Produce the replacement question for slot ${slot} now.`,
    schemaName: "draft_question",
    schema: draftQuestionJsonSchema,
    webSearch: { maxUses: 8 },
  });

  const parsed = DraftQuestionSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(`reroll: response failed validation: ${formatIssues(parsed.error.issues)}`);
  }
  const q = parsed.data;
  if (q.is_big_one !== (slot === 5)) {
    throw new Error(`reroll: is_big_one mismatch for slot ${slot}`);
  }

  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));
  // No clamping here any more: a bad resolves_at used to fall back to noon
  // D+1, which is the leaky default. The operator gets an error and reruns.
  const locksAt = lockFromResolvesAt(q.resolves_at, opensAt, locksAtDefault);
  if (q.category === "weather" && locksAt.getTime() >= locksAtDefault.getTime()) {
    throw new Error("weather must lock before noon");
  }

  // The Claude call above takes real time; re-check right before writing so
  // a publish that happened while we were waiting on Claude can't be
  // clobbered by this reroll landing late.
  const stillScheduled = await deps.db.query.questions.findFirst({
    where: and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, slot)),
  });
  if (!stillScheduled || stillScheduled.status !== "scheduled") {
    throw new Error(`draft already published for ${date}`);
  }

  await deps.db
    .update(schema.questions)
    .set({
      text: q.text,
      resolutionCriteria: q.resolution_criteria,
      sourceName: q.source_name,
      sourceUrl: q.source_url,
      category: q.category,
      marketProb: q.market_prob == null ? null : String(q.market_prob),
      locksAt,
    })
    .where(and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, slot), eq(schema.questions.status, "scheduled")));

  const updated = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const sorted = [...updated].sort((a, b) => a.slot - b.slot);
  await deps.telegram.send(
    draftMessage(
      date,
      sorted.map((row) => ({
        slot: row.slot,
        category: row.category,
        text: row.text,
        resolution_criteria: row.resolutionCriteria,
        is_big_one: row.isBigOne,
        // Pre-publish, an authored early lock is distinguishable from the
        // default: it's strictly earlier than noon D+1 (same test publish
        // itself uses to tell the two apart).
        resolves_at: row.locksAt.getTime() < locksAtDefault.getTime() ? row.locksAt.toISOString() : null,
      })),
    ),
  );
}

export function draftMessage(
  date: string,
  questions: Array<{
    slot: number;
    category: string;
    text: string;
    resolution_criteria: string;
    is_big_one: boolean;
    author_probability?: number;
    resolves_at?: string | null;
  }>,
): string {
  const sorted = [...questions].sort((a, b) => a.slot - b.slot);
  const lines = sorted.flatMap((q) => {
    const star = q.is_big_one ? "★ " : "";
    const pct = q.author_probability !== undefined ? ` (${Math.round(q.author_probability * 100)}%)` : "";
    const locks = q.resolves_at ? ` · locks ${q.resolves_at}` : " · locks at noon";
    return [`${q.slot} [${q.category}] ${star}${q.text}${pct}${locks}`, `  ↳ ${q.resolution_criteria}`];
  });
  return [`HERMES · DRAFT ${date}`, ...lines, `publishes at noon · /reroll <slot> [guidance] · /status`].join("\n");
}
