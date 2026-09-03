// Hermes authoring (spec §5): Claude drafts the daily round, we validate it
// with one retry, persist it as `scheduled` rows, and narrate the draft to
// Telegram. Also carries the operator's single-slot reroll flow.
import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import type { PipelineDeps } from "./index";
import { DraftSchema, DraftQuestionSchema, lockFromResolvesAt, RESOLVES_AFTER_LOCK, type Draft } from "./draft";
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
  resolves_at: {
    type: "string",
    description:
      'ISO-8601 UTC instant at which this outcome first becomes publicly determinable from the named source, or the literal "after-lock" when nothing about it is knowable before the round locks.',
  },
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
  "resolves_at",
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
- NEVER cite a prediction market as the resolution source — resolution always names a primary public source.
- A question adapted from a listed market MUST set resolves_at to that market's own close: the price is public and converges on the answer, so answers have to close with it.`;
}

function authorSystemPrompt(date: string, recent: string, signals: MarketSignal[]): string {
  const lockDay = addDays(date, 1);
  return `You author the daily round for ORACLE, a prediction game. Produce exactly 5 yes/no questions for the round dated ${date} (ET). The round opens at noon ET on ${date} and closes at noon ET on ${lockDay}. Rules:
- Slots 1-4: four different categories from markets, sports, weather, culture, news. Slot 5 is THE BIG ONE: the day's most contested story from any category.
- Each question must be binary YES/NO in plain English, resolvable from ONE named public source.
- THE ANSWER MUST NOT EXIST WHILE PLAYERS CAN STILL ANSWER. For every question, set resolves_at to the ISO-8601 UTC instant at which the outcome first becomes publicly determinable — the final whistle, the market's close, the moment the report is published. Answers are closed automatically at that instant, so an honest resolves_at costs you nothing and a late one hands the answer to whoever plays last. If nothing about the outcome is determinable before noon ET on ${lockDay}, set resolves_at to "after-lock".
- Prefer questions whose resolves_at lands inside the round's own window and comfortably before noon ET on ${lockDay}, so the named source has actually published before the ledger is read at 12:10 ET on ${lockDay}: an "after-lock" question will not have an answer by then.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. No gimmes.
- resolution_criteria must name the exact measurement and the exact source page. Zero ambiguity: a stranger must be able to resolve it identically.
- WEATHER: the measurement period must begin after the round opens and its end must fall before noon ET on ${lockDay} — never ask about a period already underway, because half its answer already exists, and never one that runs past the round's own close. Set resolves_at to the end of the measurement period. Weather may never use "after-lock".
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine.
- Here is how your last seven days landed. Do not repeat them, and read the outcomes and crowd splits as feedback on your own question-writing: ${recent}${marketSignalsBlock(signals)}
Search the web for today's actual news before writing. When your draft is final, call the draft_round tool exactly once.`;
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message))
    .join("; ");
}

// The last seven days, WITH how they landed. This used to return bare texts
// as a "don't repeat these" list; carrying the outcome and the crowd split
// turns it into the only feedback the author ever gets — a question the crowd
// agreed on at 91% was not contested, whatever probability the model claimed
// for it (audit 2026-09-01 §2.4).
async function recentQuestionDigest(db: Db, date: string): Promise<string> {
  const since = addDays(date, -7);
  const rows = await db.query.questions.findMany({
    where: and(gte(schema.questions.roundDate, since), lt(schema.questions.roundDate, date)),
    orderBy: (q, { asc }) => [asc(q.roundDate), asc(q.slot)],
  });
  if (rows.length === 0) return "(no history yet)";
  // One entry per line: a semicolon join let one authored question text
  // containing ";" or "→" corrupt every entry boundary after it. A newline
  // is not a realistic character in a one-line yes/no question, so this
  // entry format can't be split by the data it carries.
  return rows
    .map((r) => {
      if (r.outcome === "void") return `- ${r.text} → VOID (unresolvable — do not write questions shaped like this)`;
      if (r.outcome === null) return `- ${r.text} → not yet resolved`;
      const crowd = r.crowdYesPct === null ? "crowd unknown" : `crowd ${Math.round(Number(r.crowdYesPct))}% yes`;
      return `- ${r.text} → ${r.outcome.toUpperCase()}, ${crowd}`;
    })
    .join("\n");
}

export async function authorRound(deps: PipelineDeps, date: string): Promise<void> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const claude = deps.claude;

  const recent = await recentQuestionDigest(deps.db, date);
  // Market feeds are advisory: any failure logs inside fetchMarketSignals and
  // authoring proceeds market-blind on an empty list.
  const { signals } = await fetchMarketSignals(deps.marketFetch ?? fetch, deps.now());
  const system = authorSystemPrompt(date, recent, signals);
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

  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));
  // draftMessage wants the derived lock, not the raw resolves_at — an
  // "after-lock" question and a post-noon ISO both clamp to the same
  // instant, and only that instant is worth showing an operator. Mirrors
  // the mapping rerollSlot already does before its own draftMessage call.
  await deps.telegram.send(
    draftMessage(
      date,
      draft.questions.map((q) => {
        const locksAt = lockFromResolvesAt(q.resolves_at, opensAt, locksAtDefault);
        return { ...q, resolves_at: locksAt.getTime() < locksAtDefault.getTime() ? locksAt.toISOString() : null };
      }),
    ),
  );
}

function rerollSystemPrompt(date: string, slot: number, othersTexts: string, guidance: string): string {
  const isBigOne = slot === 5;
  const lockDay = addDays(date, 1);
  return `You author a single replacement question for the ORACLE round dated ${date} (ET), slot ${slot}${isBigOne ? " (THE BIG ONE)" : ""}. Rules:
- The question must be binary YES/NO in plain English, resolvable from ONE named public source.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. No gimmes.
- resolution_criteria must name the exact measurement and the exact source page. Zero ambiguity: a stranger must be able to resolve it identically.
- THE ANSWER MUST NOT EXIST WHILE PLAYERS CAN STILL ANSWER. For every question, set resolves_at to the ISO-8601 UTC instant at which the outcome first becomes publicly determinable — the final whistle, the market's close, the moment the report is published. Answers are closed automatically at that instant, so an honest resolves_at costs you nothing and a late one hands the answer to whoever plays last. If nothing about the outcome is determinable before noon ET on ${lockDay}, set resolves_at to "after-lock".
- WEATHER: the measurement period must begin after the round opens and its end must fall before noon ET on ${lockDay} — never ask about a period already underway, because half its answer already exists, and never one that runs past the round's own close. Set resolves_at to the end of the measurement period. Weather may never use "after-lock".
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

// ── The evergreen bank (spec §5) ───────────────────────────────────────────
//
// publishFromBank burns one entry per use and POST /admin/bank was the only
// writer, so "the drop must never depend on the agent being alive" held
// exactly as long as the buffer lasted. This is the writer that refills it.
//
// A bank entry is authored against a date that does not exist yet: it may sit
// unused for months and then publish on whatever day nobody authored. That one
// fact drives every difference from authorRound — no date in the prompt, no
// web search (a question grounded in tonight's news is dated by construction),
// and every question locked to "after-lock".

function bankSystemPrompt(): string {
  return `You author an evergreen entry for ORACLE's draft bank — a spare round held in reserve and published automatically on a day nobody authored one. Produce exactly 5 yes/no questions. Rules:
- YOU DO NOT KNOW WHAT DATE THIS WILL PUBLISH ON. It may sit in the bank for months. Nothing in a question, its resolution criteria or its source may name a date, a season, a scheduled event, a named fixture, or say "today", "tomorrow" or "this week". A question that only makes sense this month is not an evergreen question.
- Anchor every question to the round's own window instead. The round opens at noon ET and closes at noon ET the next day: write "while this round is open", "in the 24 hours before this round closes", "on the round's closing day".
- resolves_at must be the literal string "after-lock" for ALL FIVE questions — nothing about the outcome may be determinable before the round closes. There are no exceptions and no absolute instants in a bank entry: an instant authored now is already stale by the time this publishes.
- Therefore NEVER weather. A forecast is always partly knowable, so weather can never be "after-lock". Use exactly the four remaining categories — markets, sports, culture, news — one each in slots 1 to 4.
- Slot 5 is THE BIG ONE: the widest and most contested of the five, from any of those four categories.
- Each question must be binary YES/NO in plain English, resolvable from ONE named public source that will still exist and still publish the same measurement a year from now.
- resolution_criteria must name the exact measurement and the exact source page. Zero ambiguity: a stranger must be able to resolve it identically, on any date.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70, and it must be that on a typical day rather than on one particular one. No gimmes.
- Set market_prob to null: there is no live market to adapt from.
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine.
When your draft is final, call the draft_round tool exactly once.`;
}

type BankCheck = { ok: true; draft: Draft } | { ok: false; issues: string };

// DraftSchema plus the one extra rule POST /admin/bank already enforces at
// ingest. Checked here as a validation failure the retry can read, so the bank
// cannot be poisoned by its own author — publishFromBank's poison-skip stays
// the last line of defence rather than the first.
function checkBankDraft(value: unknown): BankCheck {
  const parsed = DraftSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error.issues) };
  const dated = parsed.data.questions.filter((q) => q.resolves_at !== RESOLVES_AFTER_LOCK);
  if (dated.length > 0) {
    return {
      ok: false,
      issues: `slot${dated.length > 1 ? "s" : ""} ${dated.map((q) => q.slot).join(", ")}: a bank entry must set resolves_at to "after-lock"`,
    };
  }
  return { ok: true, draft: parsed.data };
}

function bankMessage(available: number, draft: Draft): string {
  const lines = [...draft.questions]
    .sort((a, b) => a.slot - b.slot)
    .flatMap((q) => [
      `${q.slot} [${q.category}] ${q.is_big_one ? "★ " : ""}${q.text} (${Math.round(q.author_probability * 100)}%)`,
      `  ↳ ${q.resolution_criteria}`,
    ]);
  return [
    `HERMES · BANKED AN EVERGREEN ROUND (${available} in the bank)`,
    ...lines,
    `holds until a day goes unauthored · GET /admin/bank`,
  ].join("\n");
}

export async function authorBankEntry(deps: PipelineDeps): Promise<void> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const claude = deps.claude;

  const system = bankSystemPrompt();
  const baseUser = "Produce one evergreen ORACLE round for the draft bank.";
  const ask = (user: string) =>
    claude.structured({
      model: deps.models.author,
      system,
      user,
      schemaName: "draft_round",
      schema: draftRoundJsonSchema,
    });

  let checked = checkBankDraft(await ask(baseUser));
  if (!checked.ok) {
    const retryUser = `${baseUser}\n\nYour previous draft failed validation: ${checked.issues}. Produce a corrected draft.`;
    checked = checkBankDraft(await ask(retryUser));
    if (!checked.ok) {
      throw new Error(`author-bank: draft failed validation twice: ${checked.issues}`);
    }
  }

  await deps.db.insert(schema.draftBank).values({ draft: checked.draft });
  const [row] = await deps.db
    .select({ n: count() })
    .from(schema.draftBank)
    .where(isNull(schema.draftBank.usedOn));
  await deps.telegram.send(bankMessage(Number(row?.n ?? 0), checked.draft));
}
