import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";

describe("schema + harness", () => {
  it("migrates, seeds a round with 5 questions, and enforces the unique prediction index", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    expect(qs).toHaveLength(5);

    const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
    const pred = { questionId: qs[0]!.id, userId: user!.id, answer: true, confidence: 75 };
    await db.insert(schema.predictions).values(pred);
    await expect(db.insert(schema.predictions).values(pred)).rejects.toThrow(); // unique index
  });

  it("0003: crowd_count, oracle_p_yes, device ip throttle columns, draft bank, indexes", async () => {
    const { pg } = await makeTestDb();
    const cols = async (table: string) =>
      (await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = $1`, [table])).rows.map((r) => r.column_name);
    expect(await cols("questions")).toEqual(expect.arrayContaining(["crowd_count", "oracle_p_yes"]));
    expect(await cols("devices")).toEqual(expect.arrayContaining(["ip_hash", "created_at"]));
    expect(await cols("draft_bank")).toEqual(expect.arrayContaining(["id", "draft", "created_at", "used_on"]));
    const idx = (await pg.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(["predictions_user_idx", "questions_round_date_idx", "users_oracle_score_idx", "devices_ip_hash_idx"]));
  });

  it("0006: author_prob is on questions and nullable — every row asked before it predates it", async () => {
    const { db, pg } = await makeTestDb();
    const col = (await pg.query<{ is_nullable: string; data_type: string }>(
      `select is_nullable, data_type from information_schema.columns where table_name = 'questions' and column_name = 'author_prob'`,
    )).rows;
    expect(col).toHaveLength(1);
    expect(col[0]!.is_nullable).toBe("YES");
    expect(col[0]!.data_type).toBe("numeric");

    // seedRound writes no probability, exactly as the pre-0006 rows carry none.
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const rows = await db.query.questions.findMany();
    expect(rows).toHaveLength(qs.length);
    expect(rows.every((r) => r.authorProb === null)).toBe(true);
  });

  it("stores apple_sub uniquely and webhook event markers", async () => {
    const { db } = await makeTestDb();
    const [u1] = await db.insert(schema.users).values({ appleSub: "sub-1" }).returning();
    await expect(db.insert(schema.users).values({ appleSub: "sub-1" })).rejects.toThrow();
    expect(u1!.appleSub).toBe("sub-1");
    await db.insert(schema.webhookEvents).values({ id: "evt-1" });
    const dup = await db.insert(schema.webhookEvents).values({ id: "evt-1" }).onConflictDoNothing().returning();
    expect(dup).toHaveLength(0);
  });
});

describe("user_rounds", () => {
  it("stamps one vigil per user per round and refuses a second", async () => {
    const { db } = await makeTestDb();
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.userRounds).values({ userId: u!.id, date: "2026-08-20", vigilMult: "1.15" });

    const rows = await db.query.userRounds.findMany();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.vigilMult)).toBeCloseTo(1.15, 10);

    // The stamp is made once. A retry must not revise it.
    await db.insert(schema.userRounds)
      .values({ userId: u!.id, date: "2026-08-20", vigilMult: "1.50" })
      .onConflictDoNothing();
    const after = await db.query.userRounds.findMany();
    expect(after).toHaveLength(1);
    expect(Number(after[0]!.vigilMult)).toBeCloseTo(1.15, 10);
  });
});

describe("migration 0007", () => {
  it("defaults a round's provenance counts to zero, so a pre-0007 round reads as unknown", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-04" });
    const r = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-04") });
    expect(r!.candidatesWritten).toBe(0);
    expect(r!.candidatesRejected).toBe(0);
  });

  it("leaves lock_healed_at and topic_key null on an ordinary question", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-04" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-04", slot: 1, text: "Will it?", category: "news",
      resolutionCriteria: "per test", sourceName: "SRC",
      opensAt: new Date("2026-09-04T16:00:00Z"),
      locksAt: new Date("2026-09-05T16:00:00Z"),
      resolveBy: new Date("2026-09-05T17:00:00Z"),
    }).returning();
    expect(q!.lockHealedAt).toBeNull();
    expect(q!.topicKey).toBeNull();
  });

  it("leaves resolves_at and withdrawn_at null on an ordinary question (design 2026-09-09 §1)", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-10" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-10", slot: 1, text: "Will it?", category: "news",
      resolutionCriteria: "per test", sourceName: "SRC",
      opensAt: new Date("2026-09-10T16:00:00Z"),
      locksAt: new Date("2026-09-11T16:00:00Z"),
      resolveBy: new Date("2026-09-11T17:00:00Z"),
    }).returning();
    expect(q!.resolvesAt).toBeNull();
    expect(q!.withdrawnAt).toBeNull();
  });

  it("holds a spend row per date", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: 3 });
    const row = await db.query.pipelineSpend.findFirst({
      where: eq(schema.pipelineSpend.date, "2026-09-04"),
    });
    expect(row!.calls).toBe(3);
  });
});

describe("migration 0012", () => {
  it("leaves resolve_pushed_at null on a fresh prediction (design 2026-09-09 §2.1)", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-12" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-12", slot: 1, text: "Will it?", category: "news",
      resolutionCriteria: "per test", sourceName: "SRC",
      opensAt: new Date("2026-09-12T16:00:00Z"), locksAt: new Date("2026-09-13T16:00:00Z"), resolveBy: new Date("2026-09-13T17:00:00Z"),
    }).returning();
    const [u] = await db.insert(schema.users).values({}).returning();
    const [p] = await db.insert(schema.predictions).values({ questionId: q!.id, userId: u!.id, answer: true, confidence: 70 }).returning();
    expect(p!.resolvePushedAt).toBeNull();
  });
});
