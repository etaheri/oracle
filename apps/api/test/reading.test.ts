import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";
import { readingRoundFor } from "../src/reading";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";

async function user(db: Awaited<ReturnType<typeof makeTestDb>>["db"]) {
  const [u] = await db.insert(schema.users).values({}).returning();
  return u!.id;
}
async function lock(db: Awaited<ReturnType<typeof makeTestDb>>["db"], date: string) {
  await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, date));
  await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, date));
}
const win = (d: string) => ({ date: d, opensAt: new Date(`${d}T16:00:00Z`), locksAt: new Date(`${d}T16:00:00Z`) });

describe("readingRoundFor (design 2026-09-09 §2.2, §3.1)", () => {
  it("is null for a player with no locked round", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const qs = await seedRound(db, win("2026-09-10"));
    await db.insert(schema.predictions).values({ questionId: qs[0]!.id, userId: u, answer: true, confidence: 60 });
    expect(await readingRoundFor(db, u)).toBeNull(); // round still open
  });

  it("names a locked round as in play with decided/total counts", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const qs = await seedRound(db, win("2026-09-10"));
    await db.insert(schema.predictions).values({ questionId: qs[0]!.id, userId: u, answer: true, confidence: 60 });
    await lock(db, "2026-09-10");
    await resolveQuestion(db, qs[0]!.id, "yes");
    await resolveQuestion(db, qs[1]!.id, "void", { reason: "test" });
    expect(await readingRoundFor(db, u)).toEqual({ date: "2026-09-10", settled: false, decided: 2, total: 5 });
  });

  it("prefers the latest locked-or-settled round the player answered, skipping rounds they did not play", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const a = await seedRound(db, win("2026-09-08"));
    const b = await seedRound(db, win("2026-09-09"));
    await db.insert(schema.predictions).values({ questionId: a[0]!.id, userId: u, answer: true, confidence: 60 });
    await lock(db, "2026-09-08"); await lock(db, "2026-09-09");
    for (const q of a) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, "2026-09-08");
    for (const q of b) await resolveQuestion(db, q.id, "no");
    await settleRound(db, "2026-09-09");
    expect(await readingRoundFor(db, u)).toEqual({ date: "2026-09-08", settled: true, decided: 5, total: 5 });
  });

  it("reports settled once the round resolves", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const qs = await seedRound(db, win("2026-09-10"));
    await db.insert(schema.predictions).values({ questionId: qs[2]!.id, userId: u, answer: false, confidence: 80 });
    await lock(db, "2026-09-10");
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, "2026-09-10");
    expect(await readingRoundFor(db, u)).toEqual({ date: "2026-09-10", settled: true, decided: 5, total: 5 });
  });
});
