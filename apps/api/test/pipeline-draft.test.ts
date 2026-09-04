import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DraftSchema, DraftQuestionSchema, lockFromResolvesAt, RESOLVES_AFTER_LOCK, upsertDraft, type Draft } from "../src/pipeline/draft";
import { noonET } from "../src/pipeline/clock";
import { makeTestDb, seedRound } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import * as schema from "../src/db/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));

// `validDraft`'s own inferred type pins `category` to the 4 categories the
// fixture actually uses; overrides need the full schema union (e.g. to build
// a weather question inline), so annotate against `Draft["questions"]`.
function withQuestions(overrides: (qs: Draft["questions"]) => Draft["questions"]) {
  return { questions: overrides(validDraft.questions.map((q) => ({ ...q }))) };
}

const OPENS = new Date("2026-08-27T16:00:00Z"); // noon ET D
const LOCKS = new Date("2026-08-28T16:00:00Z"); // noon ET D+1

describe("lockFromResolvesAt", () => {
  it("moves the lock to the moment the answer starts existing", () => {
    expect(lockFromResolvesAt("2026-08-27T22:00:00Z", OPENS, LOCKS).toISOString()).toBe("2026-08-27T22:00:00.000Z");
  });

  it("never pushes the lock past noon D+1", () => {
    expect(lockFromResolvesAt("2026-08-29T09:00:00Z", OPENS, LOCKS).toISOString()).toBe(LOCKS.toISOString());
  });

  it("an instant exactly at noon D+1 is kept, not clamped away", () => {
    expect(lockFromResolvesAt(LOCKS.toISOString(), OPENS, LOCKS).toISOString()).toBe(LOCKS.toISOString());
  });

  it("after-lock means the full window", () => {
    expect(lockFromResolvesAt(RESOLVES_AFTER_LOCK, OPENS, LOCKS).toISOString()).toBe(LOCKS.toISOString());
  });

  it("rejects an outcome already determinable at open", () => {
    expect(() => lockFromResolvesAt("2026-08-27T15:00:00Z", OPENS, LOCKS)).toThrow("resolves_at out of range");
    expect(() => lockFromResolvesAt("2026-08-27T16:00:00Z", OPENS, LOCKS)).toThrow("resolves_at out of range");
  });

  it("rejects an unparseable timestamp", () => {
    expect(() => lockFromResolvesAt("not-a-time", OPENS, LOCKS)).toThrow("resolves_at out of range");
  });
});

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

describe("DraftQuestionSchema resolves_at", () => {
  const q = () => ({ ...validDraft.questions[0]! });

  it("requires resolves_at", () => {
    const { resolves_at: _omitted, ...without } = q();
    expect(DraftQuestionSchema.safeParse(without).success).toBe(false);
  });

  it("accepts an ISO instant and the after-lock literal", () => {
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: "2026-08-27T22:00:00Z" }).success).toBe(true);
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: RESOLVES_AFTER_LOCK }).success).toBe(true);
  });

  it("rejects any other string", () => {
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: "tomorrow" }).success).toBe(false);
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: null }).success).toBe(false);
  });

  it("forbids weather from claiming after-lock — its drift is what we are closing", () => {
    const weather = { ...q(), category: "weather" as const, resolves_at: RESOLVES_AFTER_LOCK };
    expect(DraftQuestionSchema.safeParse(weather).success).toBe(false);
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

describe("upsertDraft derives the lock", () => {
  it("stamps each question's own lock from its resolves_at", async () => {
    const { db } = await makeTestDb();
    const draft = withQuestions((qs) =>
      qs.map((q) => (q.slot === 1 ? { ...q, resolves_at: "2026-08-27T22:00:00Z" } : q)),
    );
    await upsertDraft(db, "2026-08-27", draft);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot1 = qs.find((q) => q.slot === 1)!;
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot1.locksAt.toISOString()).toBe("2026-08-27T22:00:00.000Z");
    expect(slot3.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
  });

  it("refuses a weather question that would still lock at noon D+1", async () => {
    const { db } = await makeTestDb();
    // validDraft has no weather (see helpers/draft.ts) — build one here.
    const draft = withQuestions((qs) =>
      qs.map((q) => (q.slot === 3 ? { ...q, category: "weather" as const, resolves_at: "2026-08-29T09:00:00Z" } : q)),
    );
    await expect(upsertDraft(db, "2026-08-27", draft)).rejects.toThrow("weather must lock before noon");
  });

  it("writes nothing when one question is out of range", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const bad = withQuestions((qs) => qs.map((q) => (q.slot === 2 ? { ...q, resolves_at: "2026-08-27T15:00:00Z" } : q)));
    await expect(upsertDraft(db, "2026-08-27", bad)).rejects.toThrow("resolves_at out of range");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5); // the good draft survived
    expect(qs.every((q) => q.status === "scheduled")).toBe(true);
    // Original text survived — the bad re-post never touched anything.
    expect(qs.find((q) => q.slot === 1)!.text).toBe(validDraft.questions[0]!.text);
  });
});

describe("lockFromResolvesAt across a DST boundary (design 2026-09-04 §10)", () => {
  // 2026-11-01 is the US fall-back: noon ET on 2026-10-31 is 16:00Z (EDT) and
  // noon ET on 2026-11-01 is 17:00Z (EST). A model that reasons "noon ET
  // tomorrow is 16:00Z" is an hour early, and the leak is silent.
  const opensAt = noonET("2026-10-31");
  const locksAtDefault = noonET("2026-11-01");

  it("takes the default lock from noonET, which is 17:00Z on the fall-back day", () => {
    expect(opensAt.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(locksAtDefault.toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });

  it("clamps a resolves_at in the extra hour to the real noon, never to a model's guess at it", () => {
    // 16:30Z on 2026-11-01 is 11:30 EST — still before noon ET, and inside the
    // hour that only exists because the clocks went back.
    const locks = lockFromResolvesAt("2026-11-01T16:30:00Z", opensAt, locksAtDefault);
    expect(locks.toISOString()).toBe("2026-11-01T16:30:00.000Z");
    expect(locks.getTime()).toBeLessThan(locksAtDefault.getTime());
  });

  it("clamps anything past the real noon back to it", () => {
    expect(lockFromResolvesAt("2026-11-01T20:00:00Z", opensAt, locksAtDefault).toISOString()).toBe(locksAtDefault.toISOString());
  });

  it("does the same across the spring-forward boundary", () => {
    const springOpens = noonET("2026-03-07");
    const springLocks = noonET("2026-03-08");
    expect(springOpens.toISOString()).toBe("2026-03-07T17:00:00.000Z");
    expect(springLocks.toISOString()).toBe("2026-03-08T16:00:00.000Z");
    expect(lockFromResolvesAt("2026-03-08T20:00:00Z", springOpens, springLocks).toISOString()).toBe(springLocks.toISOString());
  });
});
