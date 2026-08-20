import { describe, it, expect } from "vitest";
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
});
