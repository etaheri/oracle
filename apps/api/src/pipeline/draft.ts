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
import { addDays, noonET } from "./clock";
import { z } from "zod";

export const DraftQuestionSchema = z.object({
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

export async function upsertDraft(db: Db, date: string, draft: Draft): Promise<void> {
  const existing = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (existing && existing.status !== "scheduled") throw new Error("round not editable");

  if (existing) {
    // Questions carry an FK to rounds.date — delete children before the parent.
    await db.delete(schema.questions).where(eq(schema.questions.roundDate, date));
    await db.delete(schema.rounds).where(eq(schema.rounds.date, date));
  }

  const opensAt = noonET(date);
  const locksAt = noonET(addDays(date, 1));
  const resolveBy = new Date(locksAt.getTime() + 3_600_000);

  await db.insert(schema.rounds).values({ date, status: "scheduled" });
  await db.insert(schema.questions).values(
    draft.questions.map((q) => ({
      roundDate: date,
      slot: q.slot,
      isBigOne: q.is_big_one,
      text: q.text,
      category: q.category,
      resolutionCriteria: q.resolution_criteria,
      sourceName: q.source_name,
      sourceUrl: q.source_url,
      marketProb: q.market_prob == null ? null : String(q.market_prob),
      opensAt,
      locksAt,
      resolveBy,
      status: "scheduled" as const,
    })),
  );
}
