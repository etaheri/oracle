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
    const { db, rows, alice, bob } = await stagedRound();
    // guard_double refuses to null out a stake already frozen at seal, so an
    // unstaked (version 2 or lineless) seal is simulated by deleting the
    // staged rows for this question and reinserting them the way the seal
    // route would have: no fortuneAtSeal, stake or line.
    await db.delete(schema.predictions).where(eq(schema.predictions.questionId, rows[0]!.id));
    await db.insert(schema.predictions).values([
      { questionId: rows[0]!.id, userId: alice.id, answer: true, confidence: 70 },
      { questionId: rows[0]!.id, userId: bob.id, answer: false, confidence: 55 },
    ]);
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
  it("leaves house_delta null on a version 2 round", async () => {
    // Fortune is a version 3 rule. An older round has no staked predictions,
    // so the aggregate would sum to a truthful-looking 0 where the honest
    // answer is that the house never played.
    const { db, rows, alice, bob } = await stagedRound();
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, DATE));
    // guard_double refuses to null out a stake already frozen at seal, so an
    // unstaked (version 2) round is simulated by deleting every staged row
    // and reinserting them the way a version 2 seal would have: no
    // fortuneAtSeal, stake, line or payout.
    await db.delete(schema.predictions);
    for (const r of rows) {
      await db.insert(schema.predictions).values([
        { questionId: r.id, userId: alice.id, answer: true, confidence: 70 },
        { questionId: r.id, userId: bob.id, answer: false, confidence: 55 },
      ]);
    }
    for (const r of rows) await resolveQuestion(db, r.id, "yes");
    await settleRound(db, DATE);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.status).toBe("resolved");
    expect(round!.houseDelta).toBeNull();
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

describe("payFortune keeps the best fortune (design 2026-09-14 §4.4)", () => {
  it("raises best_fortune on a win and never lowers it on a loss", async () => {
    const { db, rows, alice } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");   // alice +74 → 1074
    let a = await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) });
    expect(a!.bestFortune).toBe(1074);
    await resolveQuestion(db, rows[1]!.id, "no");    // alice −40 → 1034
    a = await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) });
    expect(a!.fortune).toBe(1034);
    expect(a!.bestFortune).toBe(1074);
  });
  it("stays at founding for a player who only loses", async () => {
    const { db, rows, bob } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");   // bob −10
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, bob.id) }))!.bestFortune).toBe(1000);
  });
});

describe("settlement recovers a crashed fortune pass", () => {
  // Stage a fully resolved round, then rewind ONE prediction to the state a
  // crash between the claim and the credit would leave behind: payout and
  // settled_at cleared, and the credit taken back out of the fortune.
  async function crashedRound() {
    const staged = await stagedRound();
    const { db, rows, alice } = staged;
    for (const r of rows) await resolveQuestion(db, r.id, r.slot === 5 ? "no" : "yes");
    // alice: +74 on each of slots 1-4, −80 on the Big One → 1216.
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1216);
    await db.update(schema.predictions).set({ payout: null, settledAt: null })
      .where(and(eq(schema.predictions.questionId, rows[0]!.id), eq(schema.predictions.userId, alice.id)));
    await db.update(schema.users).set({ fortune: 1216 - 74 }).where(eq(schema.users.id, alice.id));
    return staged;
  }

  it("settleRound pays what a crashed resolve left unpaid", async () => {
    const { db, rows, alice } = await crashedRound();
    await settleRound(db, DATE);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1216);
    const pa = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, rows[0]!.id), eq(schema.predictions.userId, alice.id)) });
    expect(pa!.payout).toBe(114);
    expect(pa!.settledAt).not.toBeNull();
    // The sweep runs before the house delta, so the recovered stake is in it.
    expect((await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) }))!.houseDelta).toBe(-187);
  });

  it("payFortune is one statement: payout and settled_at always move together", async () => {
    const { db, rows } = await crashedRound();
    await settleRound(db, DATE);
    const all = await db.query.predictions.findMany();
    expect(all.length).toBe(rows.length * 2);
    expect(all.filter((p) => p.settledAt !== null && p.payout === null)).toEqual([]);
    expect(all.filter((p) => p.payout !== null && p.settledAt === null)).toEqual([]);
  });
});
