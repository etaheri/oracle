import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";

describe("migration 0014", () => {
  it("gives every user a founding fortune of 1000", async () => {
    const { db } = await makeTestDb();
    const [u] = await db.insert(schema.users).values({}).returning();
    expect(u!.fortune).toBe(1000);
  });
  it("carries the line and market columns on questions, the stake columns on predictions, and house_delta on rounds", async () => {
    const { db } = await makeTestDb();
    const date = "2026-09-10";
    const rows = await seedRound(db, { date, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
    await db.update(schema.questions).set({
      linePYes: "0.35", marketSource: "kalshi", marketId: "KXHIGHNY-26SEP11-B87", marketEventKey: "KXHIGHNY-26SEP11",
      marketClosesAt: new Date("2026-09-12T05:00:00Z"),
    }).where(eq(schema.questions.id, rows[0]!.id));
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(Number(q!.linePYes)).toBe(0.35);
    expect(q!.marketSource).toBe("kalshi");

    const [u] = await db.insert(schema.users).values({}).returning();
    const [p] = await db.insert(schema.predictions).values({
      questionId: rows[0]!.id, userId: u!.id, answer: true, confidence: 70, fortuneAtSeal: 1000, stake: 40, linePYes: "0.35",
    }).returning();
    expect(p!.stake).toBe(40);
    expect(p!.payout).toBeNull();
    expect(p!.settledAt).toBeNull();

    await db.update(schema.rounds).set({ houseDelta: -86 }).where(eq(schema.rounds.date, date));
    const r = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    expect(r!.houseDelta).toBe(-86);

    await db.insert(schema.userRounds).values({ userId: u!.id, date, vigilMult: "1", fortuneAtOpen: 1000 });
    const ur = await db.query.userRounds.findFirst({ where: eq(schema.userRounds.userId, u!.id) });
    expect(ur!.fortuneAtOpen).toBe(1000);
  });
  it("refuses to rewrite a house line once set", async () => {
    const { db } = await makeTestDb();
    const rows = await seedRound(db, { date: "2026-09-10", opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
    await db.update(schema.questions).set({ linePYes: "0.35" }).where(eq(schema.questions.id, rows[0]!.id));
    // drizzle-orm wraps the postgres error (message becomes "Failed query: …";
    // the trigger's "house line is immutable" text lives on err.cause, not
    // surfaced to .message) — same posture as the existing commitment-guard
    // assertions in schema.test.ts and pipeline-forecast.test.ts, which also
    // use a bare toThrow() rather than matching driver-unstable message text.
    await expect(db.update(schema.questions).set({ linePYes: "0.40" }).where(eq(schema.questions.id, rows[0]!.id))).rejects.toThrow();
    // unrelated updates still pass
    await expect(db.update(schema.questions).set({ crowdCount: 3 }).where(eq(schema.questions.id, rows[0]!.id))).resolves.toBeDefined();
  });
});
