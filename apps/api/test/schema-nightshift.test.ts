import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";

describe("migration 0017 (design 2026-09-25 §10)", () => {
  it("stores where a take was seen and whether it is the unhinged one, defaulting both", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedRound(db, { date: "2026-09-25", opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
    const before = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(before!.seenOnLabel).toBeNull();
    expect(before!.seenOnUrl).toBeNull();
    expect(before!.unhinged).toBe(false);
    await db.update(schema.questions).set({ seenOnLabel: "r/AmItheAsshole", seenOnUrl: "https://reddit.com/r/AmItheAsshole/x", unhinged: true }).where(eq(schema.questions.id, q!.id));
    const after = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(after).toMatchObject({ seenOnLabel: "r/AmItheAsshole", unhinged: true });
  });
  it("keeps one reaction per member per question and cascades with the question", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedRound(db, { date: "2026-09-25", opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
    await db.insert(schema.reactions).values({ questionId: q!.id, member: "haiku", text: "ok the room is wrong", model: "m", promptVersion: "reaction-v1" });
    await db.insert(schema.reactions).values({ questionId: q!.id, member: "haiku", text: "again" }).onConflictDoNothing();
    const rows = await db.query.reactions.findMany({ where: eq(schema.reactions.questionId, q!.id) });
    expect(rows.length).toBe(1);
    expect(rows[0]!.text).toBe("ok the room is wrong");
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    await db.delete(schema.questions).where(eq(schema.questions.id, q!.id));
    expect((await db.query.reactions.findMany()).length).toBe(0);
  });
});
