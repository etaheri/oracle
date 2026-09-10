import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { resolveQuestion, payFortune } from "../src/resolution";
import { settleRound } from "../src/settlement";

const DATE = "2026-09-10";

async function stagedRound() {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  for (const r of rows) await db.update(schema.questions).set({ linePYes: "0.35" }).where(eq(schema.questions.id, r.id));
  const [alice] = await db.insert(schema.users).values({}).returning();
  const [bob] = await db.insert(schema.users).values({}).returning();
  // alice: YES at 70 on every card (stake 40 from 1000, 80 on the Big One); bob: NO at 55 (stake 10 / 20)
  for (const r of rows) {
    await db.insert(schema.predictions).values([
      { questionId: r.id, userId: alice!.id, answer: true, confidence: 70, fortuneAtSeal: 1000, stake: r.slot === 5 ? 80 : 40, linePYes: "0.35" },
      { questionId: r.id, userId: bob!.id, answer: false, confidence: 55, fortuneAtSeal: 1000, stake: r.slot === 5 ? 20 : 10, linePYes: "0.35" },
    ]);
  }
  return { db, rows, alice: alice!, bob: bob! };
}

describe("payFortune via resolveQuestion", () => {
  it("pays a YES outcome: alice wins at 1.857× on top, bob loses his stake", async () => {
    const { db, rows, alice, bob } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");
    const a = await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) });
    const b = await db.query.users.findFirst({ where: eq(schema.users.id, bob.id) });
    expect(a!.fortune).toBe(1074); // +round(40 × 0.65/0.35) = +74
    expect(b!.fortune).toBe(990);
    const pa = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, rows[0]!.id), eq(schema.predictions.userId, alice.id)) });
    expect(pa!.payout).toBe(114);
    expect(pa!.settledAt).not.toBeNull();
  });
  it("pays a NO outcome: bob wins at 0.538× on top, alice loses", async () => {
    const { db, rows, alice, bob } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "no");
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(960);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, bob.id) }))!.fortune).toBe(1005); // +round(10 × 0.35/0.65) = +5
  });
  it("returns the stake on a void", async () => {
    const { db, rows, alice } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "void");
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1000);
    const pa = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, rows[0]!.id), eq(schema.predictions.userId, alice.id)) });
    expect(pa!.payout).toBe(40);
  });
  it("never pays twice: a second payFortune claims nothing", async () => {
    const { db, rows, alice } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");
    expect(await payFortune(db, rows[0]!.id, "yes", new Date())).toEqual({ paid: 0 });
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1074);
  });
  it("a forced re-resolution leaves the fortune untouched", async () => {
    const { db, rows, alice } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");
    await resolveQuestion(db, rows[0]!.id, "no", null, { force: true });
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1074);
  });
  it("ignores unstaked predictions (version 2 rows, or a lineless round)", async () => {
    const { db, rows, alice } = await stagedRound();
    await db.update(schema.predictions).set({ stake: null, linePYes: null }).where(eq(schema.predictions.questionId, rows[0]!.id));
    await resolveQuestion(db, rows[0]!.id, "yes");
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1000);
  });
});

describe("settleRound writes the house delta", () => {
  it("is Σ(stake − payout) over the round, written once", async () => {
    const { db, rows } = await stagedRound();
    for (const r of rows) await resolveQuestion(db, r.id, r.slot === 5 ? "no" : "yes");
    // slots 1-4 YES: alice +74 each, bob −10 each → house −64 × 4 = −256
    // slot 5 NO: alice −80, bob +round(20 × 0.538) = +11 → house +69
    await settleRound(db, DATE);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.houseDelta).toBe(-187);
    await settleRound(db, DATE); // idempotent
    expect((await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) }))!.houseDelta).toBe(-187);
  });
  it("keeps a version 3 user_rounds row written at the first seal", async () => {
    const { db, rows, alice } = await stagedRound();
    await db.insert(schema.userRounds).values({ userId: alice.id, date: DATE, vigilMult: "1", fortuneAtOpen: 1000 });
    for (const r of rows) await resolveQuestion(db, r.id, "yes");
    await settleRound(db, DATE);
    const ur = await db.query.userRounds.findFirst({ where: and(eq(schema.userRounds.userId, alice.id), eq(schema.userRounds.date, DATE)) });
    expect(ur!.fortuneAtOpen).toBe(1000);
  });
});
