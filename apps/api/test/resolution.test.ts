import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion, evidenceSummary } from "../src/resolution";
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
