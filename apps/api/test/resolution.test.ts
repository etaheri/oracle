import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion, evidenceSummary, withdrawQuestion } from "../src/resolution";
import { PIPELINE_LINES } from "@oracle/core";
import * as schema from "../src/db/schema";

describe("resolveQuestion guard", () => {
  it("resolves an open or locked question and stamps crowd_count", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await resolveQuestion(db, qs[0]!.id, "yes");
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[0]!.id) });
    expect(q!.status).toBe("resolved");
    expect(q!.crowdCount).toBe(0);
  });
  it("refuses to re-resolve a resolved question without force", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await resolveQuestion(db, qs[0]!.id, "yes");
    await expect(resolveQuestion(db, qs[0]!.id, "no")).rejects.toThrow("not resolvable");
    await resolveQuestion(db, qs[0]!.id, "no", null, { force: true });
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[0]!.id) });
    expect(q!.outcome).toBe("no");
  });
  it("refuses a scheduled question", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await db.update(schema.questions).set({ status: "scheduled" }).where(eq(schema.questions.id, qs[0]!.id));
    await expect(resolveQuestion(db, qs[0]!.id, "yes")).rejects.toThrow("not resolvable");
  });
});

describe("evidenceSummary", () => {
  it("lifts the first quote and a reason, tolerating any shape", () => {
    expect(evidenceSummary({ quotes: [{ url: "https://example.com/result", quote: "Final: 3-1" }], reasoning: "r" })).toEqual({ quote: "Final: 3-1", quoteUrl: "https://example.com/result", reason: null });
    expect(evidenceSummary({ unverifiable: true, reason: "unverifiable by 13:00 ET" })).toEqual({ quote: null, quoteUrl: null, reason: "unverifiable by 13:00 ET" });
    expect(evidenceSummary(null)).toEqual({ quote: null, quoteUrl: null, reason: null });
    expect(evidenceSummary("junk")).toEqual({ quote: null, quoteUrl: null, reason: null });
    expect(evidenceSummary({ quotes: "nope" })).toEqual({ quote: null, quoteUrl: null, reason: null });
  });
});

describe("withdrawQuestion (design 2026-09-09 §1.4)", () => {
  it("closes the lock, marks withdrawn, voids with the honest reason, zeroes predictions", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, "2026-09-09"));
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({ userId: u!.id, questionId: qs[2]!.id, answer: true, confidence: 70 });
    const now = new Date("2026-09-09T20:00:00Z");
    const { remaining } = await withdrawQuestion(db, qs[2]!.id, "misauthored", now);
    expect(remaining).toBe(4);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[2]!.id) });
    expect(q!.status).toBe("void");
    expect(q!.outcome).toBe("void");
    expect(q!.withdrawnAt?.toISOString()).toBe(now.toISOString());
    expect(q!.locksAt.toISOString()).toBe(now.toISOString());
    expect(q!.lockHealedAt).toBeNull();
    expect((q!.resolutionEvidence as { reason: string }).reason).toBe(PIPELINE_LINES.withdrawnMisauthored);
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.questionId, qs[2]!.id) });
    expect(p!.points).toBe(0);
    expect(p!.brier).toBeNull();
  });
  it("refuses a second withdrawal and a resolved question", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    await withdrawQuestion(db, qs[0]!.id, "unresolvable", new Date("2026-09-09T20:00:00Z"));
    await expect(withdrawQuestion(db, qs[0]!.id, "unresolvable", new Date())).rejects.toThrow("already withdrawn");
    await resolveQuestion(db, qs[1]!.id, "yes");
    await expect(withdrawQuestion(db, qs[1]!.id, "misauthored", new Date())).rejects.toThrow("not withdrawable");
  });
  it("finishes a crashed half-withdrawal on retry instead of sticking behind 'already withdrawn'", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({ userId: u!.id, questionId: qs[2]!.id, answer: true, confidence: 70 });
    // Simulate a crash between the two writes: withdrawn_at/locks_at landed,
    // the void through resolveQuestion never ran.
    const crashedAt = new Date("2026-09-09T20:00:00Z");
    await db.update(schema.questions).set({ withdrawnAt: crashedAt, locksAt: crashedAt }).where(eq(schema.questions.id, qs[2]!.id));
    const { remaining } = await withdrawQuestion(db, qs[2]!.id, "misauthored", new Date("2026-09-09T20:05:00Z"));
    expect(remaining).toBe(4);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[2]!.id) });
    expect(q!.status).toBe("void");
    expect(q!.withdrawnAt?.toISOString()).toBe(crashedAt.toISOString());
    expect(q!.locksAt.toISOString()).toBe(crashedAt.toISOString());
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.questionId, qs[2]!.id) });
    expect(p!.points).toBe(0);
    expect(p!.brier).toBeNull();
    await expect(withdrawQuestion(db, qs[2]!.id, "misauthored", new Date())).rejects.toThrow("already withdrawn");
  });
});
