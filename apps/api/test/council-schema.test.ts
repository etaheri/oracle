import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { upsertDraft, DraftSchema } from "../src/pipeline/draft";
import { validDraft } from "./helpers/draft";

// 2099, not 2026: commit_oracle_forecast compares the opening deadline with the
// database clock, so a real date would fail with "opening deadline passed".
const DATE = "2099-09-10";

async function scheduled() {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2099-09-10T16:00:00Z"), locksAt: new Date("2099-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "scheduled", marketProb: "0.40" }).where(eq(schema.questions.roundDate, DATE));
  return { db, rows };
}

function snapshotFor(qs: { id: string; slot: number }[], full: Array<typeof schema.questions.$inferSelect>, pYes: number) {
  return full.map((q) => ({
    id: q.id, slot: q.slot, isBigOne: q.isBigOne, text: q.text, category: q.category, resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName, sourceUrl: q.sourceUrl, context: q.context, opensAt: q.opensAt.toISOString(), locksAt: q.locksAt.toISOString(), pYes,
  }));
}

describe("migration 0015", () => {
  it("creates lines, evidence and lessons, and the series key", async () => {
    const { db, rows } = await scheduled();
    await db.insert(schema.evidence).values({ questionId: rows[0]!.id, rank: 1, url: "https://a", title: "A", source: "a", publishedAt: null, highlight: "h", retrievedAt: new Date() });
    await db.insert(schema.lessons).values({ member: "sonnet", seriesKey: "KXHIGHNY", questionId: rows[0]!.id, text: "Lesson.", resolvedAt: new Date() });
    await db.update(schema.questions).set({ marketSeriesKey: "KXHIGHNY" }).where(eq(schema.questions.id, rows[0]!.id));
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(q!.marketSeriesKey).toBe("KXHIGHNY");
    expect((await db.query.evidence.findMany()).length).toBe(1);
    expect((await db.query.lessons.findMany()).length).toBe(1);
  });

  it("commit_council writes oracle_p_yes and the lines rows together, once", async () => {
    const { db, rows } = await scheduled();
    const full = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    const snapshot = snapshotFor(rows, full, 0.4);
    const lines = full.flatMap((q) => [
      { question_id: q.id, member: "sonnet", p_yes: 0.4, model: "m-s", prompt_version: "council-v1", reasoning: "R.", cited: [1, 2], lessons_received: [] },
      { question_id: q.id, member: "market", p_yes: 0.4, model: null, prompt_version: null, reasoning: null, cited: [], lessons_received: [] },
    ]);
    const call = (checkedAt: string) => db.execute(sql`select commit_council(${DATE}::date, ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${"council-v1"}, ${checkedAt}::timestamptz) as ok`);
    const first = await call("2099-09-10T14:00:00Z");
    expect((first.rows[0] as { ok: boolean }).ok).toBe(true);
    const written = await db.query.lines.findMany();
    expect(written.length).toBe(10);
    expect(written.find((l) => l.member === "sonnet")!.cited).toEqual([1, 2]);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.oracleForecastModel).toBe("council");
    expect(round!.oraclePromptVersion).toBe("council-v1");
    expect(Number((await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) }))!.oracleProbYes)).toBe(0.4);
    // A second call is a no-op: commit_oracle_forecast returns false and no lines are added.
    const second = await call("2099-09-10T14:05:00Z");
    expect((second.rows[0] as { ok: boolean }).ok).toBe(false);
    expect((await db.query.lines.findMany()).length).toBe(10);
  });

  it("a failed snapshot check rolls the lines back too", async () => {
    const { db, rows } = await scheduled();
    const full = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE) });
    const snapshot = snapshotFor(rows, full, 0.4).map((s, i) => (i === 0 ? { ...s, text: "changed" } : s));
    const lines = [{ question_id: rows[0]!.id, member: "sonnet", p_yes: 0.4, model: "m", prompt_version: "v", reasoning: "R.", cited: [], lessons_received: [] }];
    // drizzle-orm wraps the Postgres error in a DrizzleQueryError whose own
    // .message is the generic "Failed query: ..." string; the function's
    // actual RAISE EXCEPTION text lands in .cause.
    const err: unknown = await db
      .execute(sql`select commit_council(${DATE}::date, ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${"v"}, ${"2099-09-10T14:00:00Z"}::timestamptz)`)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(((err as Error).cause as Error | undefined)?.message).toMatch(/snapshot/);
    expect((await db.query.lines.findMany()).length).toBe(0);
  });

  it("lines rows are immutable", async () => {
    const { db, rows } = await scheduled();
    await db.insert(schema.lines).values({ questionId: rows[0]!.id, member: "haiku", pYes: "0.5", committedAt: new Date() });
    // See the note above: the trigger's RAISE EXCEPTION text is on .cause,
    // not on the wrapping DrizzleQueryError's own .message.
    const err: unknown = await db
      .update(schema.lines)
      .set({ pYes: "0.6" })
      .where(eq(schema.lines.member, "haiku"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(((err as Error).cause as Error | undefined)?.message).toMatch(/immutable/);
  });

  it("the draft carries the series key through upsertDraft", async () => {
    const { db } = await makeTestDb();
    const draft = DraftSchema.parse({
      questions: validDraft.questions.map((q, i) => ({
        ...q, resolves_at: "2026-09-12T20:00:00.000Z",
        market: { source: "kalshi", id: `T${i}`, event_key: `E${i}`, series_key: `S${i}`, closes_at: "2026-09-12T20:00:00.000Z" },
      })),
    });
    await upsertDraft(db, "2026-09-11", draft, 3);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-09-11"), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.map((q) => q.marketSeriesKey)).toEqual(["S0", "S1", "S2", "S3", "S4"]);
  });
});
