import { QuestionContextSchema } from "@oracle/core";
// Draft round schema + upsert (Hermes pipeline, spec §4-5). A "draft" is the
// human/Claude-authored shape of a round before it becomes DB rows: five
// questions, slots 1..5, exactly one big-one at slot 5, at least 4 distinct
// categories among the five. upsertDraft turns a validated Draft into
// `scheduled` round + question rows, replacing any prior scheduled draft for
// the same date. neon-http has no transactions, so the delete-then-insert
// below is sequential, not atomic — safe because it only ever touches
// `scheduled` rows (never open/locked/resolved), and a failure mid-sequence
// is simply retried by re-posting the same draft.
import { eq } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import { addDays, fastResolveBy, noonET, voidDeadline } from "./clock";
import { z } from "zod";

// The outcome's own clock. The model states a FACT — when does this become
// publicly determinable — and the code derives the policy. `locks_at` used to
// be an optional policy call the model made for itself, defaulting to noon
// D+1, which is the maximally-leaky value; that default is why every question
// stayed answerable after its answer existed (audit 2026-09-01 §1.1).
export const RESOLVES_AFTER_LOCK = "after-lock";

export const DraftQuestionSchema = z
  .object({
    slot: z.number().int().min(1).max(5),
    category: z.enum(["markets", "sports", "weather", "culture", "news"]),
    text: z.string().min(10),
    resolution_criteria: z.string().min(10),
    source_name: z.string().min(1),
    source_url: z.string().url(),
    author_probability: z.number().min(0.3).max(0.7),
    is_big_one: z.boolean(),
    // Set when the question was adapted from a live prediction market (feeds.ts);
    // stamped into questions.market_prob for later reveal display.
    market_prob: z.number().min(0).max(1).nullable().default(null),
    // Required. Either the ISO-8601 instant the outcome first becomes
    // publicly determinable, or "after-lock" when nothing about it is
    // knowable before noon ET D+1.
    resolves_at: z.union([z.iso.datetime({ offset: true }), z.literal(RESOLVES_AFTER_LOCK)]),
    // The normalized subject, when the gauntlet authored this question.
    // Optional: /reroll, the evergreen bank and the admin API all post
    // drafts that never had one, and none of them should have to change to
    // keep working (design 2026-09-04 §3.1). No `.default(null)` — that
    // would stamp an explicit null onto every draft's parsed shape, even
    // ones that never carried the key, and break structural equality
    // against fixtures/DB rows that predate it.
    context: QuestionContextSchema.optional(),
    topic_key: z.string().min(3).max(64).nullable().optional(),
  })
  .superRefine((q, ctx) => {
    // Weather's information arrives continuously, so "after-lock" is never
    // true of it — a forecast is always partly knowable. Forcing an instant
    // forces the lock to the end of the measurement window.
    if (q.category === "weather" && q.resolves_at === RESOLVES_AFTER_LOCK) {
      ctx.addIssue({ code: "custom", message: "weather must name a resolves_at instant", path: ["resolves_at"] });
    }
  });

export const DraftSchema = z
  .object({ questions: z.array(DraftQuestionSchema).length(5) })
  .superRefine((v, ctx) => {
    const slots = v.questions.map((q) => q.slot).sort((a, b) => a - b);
    const wantSlots = [1, 2, 3, 4, 5];
    if (slots.some((s, i) => s !== wantSlots[i])) {
      ctx.addIssue({ code: "custom", message: "slots must be exactly 1..5", path: ["questions"] });
    }

    const bigOnes = v.questions.filter((q) => q.is_big_one);
    if (bigOnes.length !== 1) {
      ctx.addIssue({ code: "custom", message: "exactly one question must be the big one", path: ["questions"] });
    } else if (bigOnes[0]!.slot !== 5) {
      ctx.addIssue({ code: "custom", message: "the big one must be slot 5", path: ["questions"] });
    }

    const distinctCategories = new Set(v.questions.map((q) => q.category)).size;
    if (distinctCategories < 4) {
      ctx.addIssue({ code: "custom", message: "at least 4 distinct categories required", path: ["questions"] });
    }
  });

export type Draft = z.infer<typeof DraftSchema>;

// The lock always moves to the information: a question can never remain
// answerable once its outcome exists. Never later than the round's own noon.
export function lockFromResolvesAt(resolvesAt: string, opensAt: Date, defaultLocksAt: Date): Date {
  if (resolvesAt === RESOLVES_AFTER_LOCK) return defaultLocksAt;
  const t = new Date(resolvesAt);
  if (Number.isNaN(t.getTime()) || t.getTime() <= opensAt.getTime()) {
    throw new Error("resolves_at out of range");
  }
  return t.getTime() < defaultLocksAt.getTime() ? t : defaultLocksAt;
}

export interface FastRoundWindow { lockAt: Date; fastBy: Date; voidAt: Date }

// The fast-round rule (design 2026-09-09 §1.1-1.2). A v2 round settles only
// when its slowest question does, so one Sunday question holds the whole
// verdict two days. Every concrete instant must land before the void
// deadline, and at most one may land after the evening — and that one must be
// the Big One. "after-lock" carries no instant and counts as fast: it is a
// claim that nothing is knowable before the lock, not a claim of lateness.
export function checkFastRound(
  questions: ReadonlyArray<{ slot: number; is_big_one: boolean; resolves_at: string }>,
  window: FastRoundWindow,
): string | null {
  let slow = 0;
  for (const q of questions) {
    if (q.resolves_at === RESOLVES_AFTER_LOCK) continue;
    const t = new Date(q.resolves_at).getTime();
    if (t > window.voidAt.getTime()) return "resolves_at is past the void deadline";
    if (t > window.fastBy.getTime()) {
      slow += 1;
      if (!q.is_big_one || slow > 1) return "only the big one may resolve after the evening";
    }
  }
  return null;
}

export async function upsertDraft(db: Db, date: string, draft: Draft, rulesVersion = 1): Promise<void> {
  const existing = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (existing && (existing.status !== "scheduled" || existing.oracleCommittedAt !== null)) throw new Error("round not editable");

  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));
  const resolveBy = new Date(locksAtDefault.getTime() + 3_600_000);

  if (rulesVersion >= 2) {
    const fast = checkFastRound(draft.questions, { lockAt: locksAtDefault, fastBy: fastResolveBy(date), voidAt: voidDeadline(date) });
    if (fast) throw new Error(fast);
  }

  // Validate ALL rows (including each question's resolves_at) before any
  // write — this map throws on the first "resolves_at out of range" or
  // "weather must lock before noon", before we touch the DB at all.
  // Critical: this must run before the delete-existing-draft block below, or
  // a re-post with one bad resolves_at would destroy a good scheduled round
  // before the bad value is ever caught.
  const rows = draft.questions.map((q) => {
    const locksAt = lockFromResolvesAt(q.resolves_at, opensAt, locksAtDefault);
    if (rulesVersion < 2 && q.category === "weather" && locksAt.getTime() >= locksAtDefault.getTime()) {
      throw new Error("weather must lock before noon");
    }
    if (rulesVersion >= 2 && locksAt.getTime() < locksAtDefault.getTime()) throw new Error("new rounds require the full common answering window");
    if (q.context && Date.parse(q.context.asOf) > opensAt.getTime()) throw new Error("context must predate publication");
    return {
      context: q.context ?? null,
      roundDate: date,
      slot: q.slot,
      isBigOne: q.is_big_one,
      text: q.text,
      category: q.category,
      resolutionCriteria: q.resolution_criteria,
      sourceName: q.source_name,
      sourceUrl: q.source_url,
      marketProb: q.market_prob == null ? null : String(q.market_prob),
      // The author's own claim, kept. It was validated into the 0.3-0.7 band
      // and then dropped on the floor, so nothing could ever score it
      // against what happened and nothing measured whether the questions
      // were contested (design 2026-09-03 §6).
      authorProb: String(q.author_probability),
      topicKey: q.topic_key,
      opensAt,
      locksAt,
      resolvesAt: q.resolves_at === RESOLVES_AFTER_LOCK ? null : new Date(q.resolves_at),
      resolveBy,
      status: "scheduled" as const,
    };
  });

  if (existing) {
    // Questions carry an FK to rounds.date — delete children before the parent.
    await db.delete(schema.questions).where(eq(schema.questions.roundDate, date));
    await db.delete(schema.rounds).where(eq(schema.rounds.date, date));
  }

  await db.insert(schema.rounds).values({ date, status: "scheduled", rulesVersion });
  await db.insert(schema.questions).values(rows);
}
