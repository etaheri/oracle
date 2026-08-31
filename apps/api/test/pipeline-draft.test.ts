import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DraftSchema, upsertDraft } from "../src/pipeline/draft";
import { makeTestDb, seedRound } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import * as schema from "../src/db/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  it("the bank-draft-example.json doc asset always parses as a valid draft", () => {
    const path = join(__dirname, "../../../docs/superpowers/plans/assets/bank-draft-example.json");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(() => DraftSchema.parse(raw)).not.toThrow();
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

  it("an authored early locks_at is kept; null defaults to noon D+1; out of range throws", async () => {
    const { db } = await makeTestDb();
    const early = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-28T00:00:00Z" } : q)) };
    await upsertDraft(db, "2026-08-27", DraftSchema.parse(early));
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27"), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs[1]!.locksAt.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(qs[0]!.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
    const late = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-29T00:00:00Z" } : q)) };
    await expect(upsertDraft(db, "2026-08-27", DraftSchema.parse(late))).rejects.toThrow("locks_at out of range");
    const before = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-27T15:00:00Z" } : q)) };
    await expect(upsertDraft(db, "2026-08-27", DraftSchema.parse(before))).rejects.toThrow("locks_at out of range");
  });

  it("locks_at exactly at opensAt throws; locks_at exactly at noon D+1 is allowed", async () => {
    const { db } = await makeTestDb();
    const atOpen = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-27T16:00:00Z" } : q)) };
    await expect(upsertDraft(db, "2026-08-27", DraftSchema.parse(atOpen))).rejects.toThrow("locks_at out of range");

    const atDefault = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-28T16:00:00Z" } : q)) };
    await upsertDraft(db, "2026-08-27", DraftSchema.parse(atDefault));
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs.find((q) => q.slot === 2)!.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
  });

  it("a bad re-post's locks_at validation failure leaves a prior good scheduled round untouched", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);

    const bad = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-29T00:00:00Z" } : q)) };
    await expect(upsertDraft(db, "2026-08-27", DraftSchema.parse(bad))).rejects.toThrow("locks_at out of range");

    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round).toBeDefined();
    expect(round!.status).toBe("scheduled");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5);
    expect(qs.every((q) => q.status === "scheduled")).toBe(true);
    // Original text survived — the bad re-post never touched anything.
    expect(qs.find((q) => q.slot === 1)!.text).toBe(validDraft.questions[0]!.text);
  });
});
