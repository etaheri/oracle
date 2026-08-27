import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DraftSchema, upsertDraft } from "../src/pipeline/draft";
import { makeTestDb, seedRound } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import * as schema from "../src/db/schema";

function withQuestions(overrides: (qs: typeof validDraft.questions) => typeof validDraft.questions) {
  return { questions: overrides(validDraft.questions.map((q) => ({ ...q }))) };
}

describe("DraftSchema", () => {
  it("accepts a valid draft", () => {
    expect(DraftSchema.safeParse(validDraft).success).toBe(true);
  });

  it("rejects 6 questions", () => {
    const draft = { questions: [...validDraft.questions, { ...validDraft.questions[0]!, slot: 6 }] };
    expect(DraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects two big-ones", () => {
    const draft = withQuestions((qs) => qs.map((q) => (q.slot === 4 ? { ...q, is_big_one: true } : q)));
    expect(DraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects a big-one at slot 3 instead of 5", () => {
    const draft = withQuestions((qs) =>
      qs.map((q) => (q.slot === 5 ? { ...q, is_big_one: false } : q.slot === 3 ? { ...q, is_big_one: true } : q)),
    );
    expect(DraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects probability 0.2", () => {
    const draft = withQuestions((qs) => qs.map((q) => (q.slot === 1 ? { ...q, author_probability: 0.2 } : q)));
    expect(DraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects fewer than 4 distinct categories", () => {
    const draft = withQuestions((qs) => qs.map((q) => ({ ...q, category: q.slot === 5 ? q.category : ("news" as const) })));
    expect(DraftSchema.safeParse(draft).success).toBe(false);
  });
});

describe("upsertDraft", () => {
  it("round-trips a valid draft into scheduled rows with noon stamps", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);

    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round!.status).toBe("scheduled");

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5);
    expect(qs.every((q) => q.status === "scheduled")).toBe(true);
    expect(qs[0]!.opensAt.toISOString()).toBe("2026-08-27T16:00:00.000Z");
    expect(qs[0]!.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
    expect(qs[0]!.resolveBy.toISOString()).toBe("2026-08-28T17:00:00.000Z");
    const bigOne = qs.find((q) => q.slot === 5)!;
    expect(bigOne.isBigOne).toBe(true);
  });

  it("replaces a prior scheduled draft for the same date", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const replacement = withQuestions((qs) => qs.map((q) => (q.slot === 1 ? { ...q, text: "Will the replacement thing happen tomorrow?" } : q)));
    await upsertDraft(db, "2026-08-27", replacement);

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5);
    expect(qs.find((q) => q.slot === 1)!.text).toBe("Will the replacement thing happen tomorrow?");
  });

  it("throws when the round exists and is not scheduled", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-27", opensAt: new Date("2026-08-27T16:00:00Z"), locksAt: new Date("2026-08-28T16:00:00Z") });
    await expect(upsertDraft(db, "2026-08-27", validDraft)).rejects.toThrow("round not editable");
  });
});
