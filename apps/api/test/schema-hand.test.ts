import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";

const DATE = "2026-09-10";

async function sealed() {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  const [u] = await db.insert(schema.users).values({}).returning();
  const [p] = await db.insert(schema.predictions).values({
    questionId: rows[0]!.id, userId: u!.id, answer: true, confidence: 75, fortuneAtSeal: 1000, stake: 50, linePYes: "0.35",
  }).returning();
  return { db, rows, u: u!, p: p! };
}

const cause = (err: unknown) => String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message);

describe("migration 0016 (design 2026-09-14 §7)", () => {
  it("gives every user a best fortune of 1000 and no run start", async () => {
    const { u } = await sealed();
    expect(u.bestFortune).toBe(1000);
    expect(u.runStartedOn).toBeNull();
  });
  it("carries doubled on predictions and the double and bust on user_rounds", async () => {
    const { db, rows, u, p } = await sealed();
    expect(p.doubled).toBe(false);
    await db.insert(schema.userRounds).values({ userId: u.id, date: DATE, vigilMult: "1", fortuneAtOpen: 1000, doubleQuestionId: rows[0]!.id, bustFortune: 60 });
    const ur = await db.query.userRounds.findFirst({ where: eq(schema.userRounds.userId, u.id) });
    expect(ur!.doubleQuestionId).toBe(rows[0]!.id);
    expect(ur!.bustFortune).toBe(60);
  });
  it("refuses any change to a stake except the double", async () => {
    const { db, p } = await sealed();
    const err = await db.update(schema.predictions).set({ stake: 999 }).where(eq(schema.predictions.id, p.id)).then(() => null, (e: unknown) => e);
    expect(err).toBeTruthy();
    expect(cause(err)).toMatch(/only the double may change it/);
    // The double: doubled false → true with the stake exactly doubled.
    await expect(db.update(schema.predictions).set({ stake: 100, doubled: true }).where(eq(schema.predictions.id, p.id))).resolves.toBeDefined();
    const after = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, p.id) });
    expect(after).toMatchObject({ stake: 100, doubled: true });
    // Never twice.
    const again = await db.update(schema.predictions).set({ stake: 200, doubled: true }).where(eq(schema.predictions.id, p.id)).then(() => null, (e: unknown) => e);
    expect(cause(again)).toMatch(/only the double may change it/);
  });
  it("refuses the double on a settled row, and lets settlement write payout without touching the stake", async () => {
    const { db, p } = await sealed();
    await db.update(schema.predictions).set({ payout: 143, settledAt: new Date() }).where(eq(schema.predictions.id, p.id));
    const err = await db.update(schema.predictions).set({ stake: 100, doubled: true }).where(eq(schema.predictions.id, p.id)).then(() => null, (e: unknown) => e);
    expect(cause(err)).toMatch(/only the double may change it/);
  });
});
