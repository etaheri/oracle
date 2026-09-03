import { describe, expect, it, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { runTick, type PipelineDeps } from "../src/pipeline";
import { voidQuestions, publishFromBank } from "../src/pipeline/actions";
import { resolveQuestion } from "../src/resolution";
import * as schema from "../src/db/schema";
import { buildPipelineDeps, type WorkerEnv } from "../src/worker";
import { createApp } from "../src/app";

const authEnv = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean, confidence: number) => JSON.stringify({ question_id: q, answer, confidence, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

function fakeDeps(db: PipelineDeps["db"], nowIso: string) {
  const sent: string[] = [];
  const deps: PipelineDeps = {
    db, claude: null, models: { author: "m-a", resolve: "m-r", forecast: "m-f" },
    telegram: { send: async (t) => void sent.push(t) },
    now: () => new Date(nowIso),
  };
  return { deps, sent };
}

describe("runTick", () => {
  it("locks a round whose lock time has passed", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const { deps } = fakeDeps(db, "2026-08-27T16:01:00Z");
    const done = await runTick(deps);
    expect(done).toContain("lock:2026-08-26");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-26") });
    expect(round!.status).toBe("locked");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-26") });
    expect(qs.every((q) => q.status === "locked")).toBe(true);
  });

  it("lock no longer stamps a forecast from the crowd — that is now a separate, crowd-blind action", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env: authEnv });
    const qs = await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    vi.useFakeTimers({ now: new Date("2026-08-26T16:30:00Z"), toFake: ["Date"] });
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true, 75) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true, 55) });
    await c("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false, 65) });
    vi.useRealTimers();
    const { deps } = fakeDeps(db, "2026-08-27T16:00:00Z");
    const done = await runTick(deps);
    expect(done).toContain("lock:2026-08-26");
    const questions = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, "2026-08-26"),
      orderBy: (q, { asc }) => [asc(q.slot)],
    });
    // The crowd predicted; lock must never let that leak into oracleProbYes.
    expect(questions.every((q) => q.oracleProbYes === null)).toBe(true);
  });

  it("publishes a scheduled draft at noon and stamps noon open/lock times", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-08-27", status: "scheduled" });
    await db.insert(schema.questions).values([1, 2, 3, 4, 5].map((slot) => ({
      roundDate: "2026-08-27", slot, isBigOne: slot === 5, text: `Q${slot}?`, category: "news" as const,
      resolutionCriteria: "c", sourceName: "s", opensAt: new Date(0), locksAt: new Date(0), resolveBy: new Date(0), status: "scheduled" as const,
    })));
    const { deps } = fakeDeps(db, "2026-08-27T16:01:00Z");
    expect(await runTick(deps)).toContain("publish:2026-08-27");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs[0]!.opensAt.toISOString()).toBe("2026-08-27T16:00:00.000Z");
    expect(qs[0]!.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
    expect(qs.every((q) => q.status === "open")).toBe(true);
  });

  it("publish keeps an authored early locks_at and defaults everything else (incl. epoch-seeded rows) to noon D+1", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-08-27", status: "scheduled" });
    await db.insert(schema.questions).values([1, 2, 3, 4, 5].map((slot) => ({
      roundDate: "2026-08-27", slot, isBigOne: slot === 5, text: `Q${slot}?`, category: "news" as const,
      resolutionCriteria: "c", sourceName: "s", opensAt: new Date(0),
      locksAt: slot === 2 ? new Date("2026-08-28T00:00:00Z") : new Date(0),
      resolveBy: new Date(0), status: "scheduled" as const,
    })));
    const { deps } = fakeDeps(db, "2026-08-27T16:01:00Z");
    expect(await runTick(deps)).toContain("publish:2026-08-27");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27"), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs[1]!.locksAt.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(qs[0]!.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
  });

  it("refuses to publish while another round is open (WARN instead)", async () => {
    const { db } = await makeTestDb();
    // open round whose lock is NOT passed (hand-seeded anomaly)
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-29T16:00:00Z") });
    // Already forecast, so this tick's decision is about publish alone, not
    // muddied by a forecast retry (claude is null in this file's fakeDeps).
    await db.update(schema.questions).set({ oracleProbYes: "0.5" }).where(eq(schema.questions.roundDate, "2026-08-26"));
    await db.insert(schema.rounds).values({ date: "2026-08-27", status: "scheduled" });
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:01:00Z");
    const done = await runTick(deps);
    expect(done.some((d) => d.startsWith("publish"))).toBe(false);
    expect(sent.length).toBe(0); // decide layer already skips publish; no warn needed here
  });

  it("voids unresolved questions at noon 24 hours after lock and then settles on the next tick", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    for (const q of qs.slice(0, 3)) await resolveQuestion(db, q.id, "yes");
    const { deps: d1 } = fakeDeps(db, "2026-08-27T17:05:00Z"); // 13:05 ET
    let done = await runTick(d1); // lock happens this tick
    expect(done).toContain("lock:2026-08-26");
    const { deps: d2, sent } = fakeDeps(db, "2026-08-28T16:05:00Z"); // noon ET, D+2 from lock date
    done = await runTick(d2); // void the 2 stragglers
    expect(done).toContain("void:2026-08-26");
    expect(sent.some((t) => t.includes("⚠"))).toBe(true);
    const { deps: d3, sent: sent3 } = fakeDeps(db, "2026-08-28T16:15:00Z");
    done = await runTick(d3);
    expect(done).toContain("settle:2026-08-26");
    expect(sent3.some((t) => t.includes("reply if any outcome looks wrong"))).toBe(true);
    const report = sent3.find((t) => t.includes("reply if any outcome looks wrong"))!;
    expect(report).toContain("LEAK WATCH");
    // No predictions on this round, so every slot reports honestly rather
    // than inventing a drift from a sample of zero.
    expect(report).toContain("too few seals");
    expect(report).toContain("early-lock rate 0/5");
    const voided = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-26") });
    expect(voided.filter((q) => q.status === "void").length).toBe(2);
    for (const q of voided.filter((q) => q.status === "void")) {
      expect((q.resolutionEvidence as { reason: string }).reason).toBe("unverifiable within 24 hours of lock");
    }
  });

  it("author failure becomes a WARN, not a crash", async () => {
    const { db } = await makeTestDb();
    const { deps, sent } = fakeDeps(db, "2026-08-27T21:05:00Z"); // 17:05 ET
    const done = await runTick(deps); // stub authorRound throws "authoring not wired"
    expect(done.some((d) => d.startsWith("author"))).toBe(false);
    expect(sent.some((t) => t.includes("author failed"))).toBe(true);
  });

  it("noon with no draft publishes the oldest bank entry and marks it used", async () => {
    const { db } = await makeTestDb();
    const [older, newer] = await db
      .insert(schema.draftBank)
      .values([
        { draft: validDraft, createdAt: new Date("2026-08-20T00:00:00Z") },
        { draft: validDraft, createdAt: new Date("2026-08-21T00:00:00Z") },
      ])
      .returning({ id: schema.draftBank.id });
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:00:00Z"); // noon ET, nothing scheduled
    const done = await runTick(deps);
    expect(done).toContain("publish-bank:2026-08-27");

    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round!.status).toBe("open");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs.filter((q) => q.status === "open")).toHaveLength(5);

    const olderRow = await db.query.draftBank.findFirst({ where: eq(schema.draftBank.id, older!.id) });
    const newerRow = await db.query.draftBank.findFirst({ where: eq(schema.draftBank.id, newer!.id) });
    expect(olderRow!.usedOn).toBe("2026-08-27");
    expect(newerRow!.usedOn).toBeNull();

    expect(sent.some((t) => /published from the evergreen bank \(1 left\)/.test(t))).toBe(true);
  });

  it("publishFromBank sends no 'published from the evergreen bank' message when another round is still open", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-29T16:00:00Z") }); // still open, lock not passed
    await db.insert(schema.draftBank).values({ draft: validDraft, createdAt: new Date("2026-08-20T00:00:00Z") });
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:00:00Z");
    const published = await publishFromBank(db, deps.telegram, "2026-08-27");
    expect(published).toBe(false);
    expect(sent.some((t) => t.includes("published from the evergreen bank"))).toBe(false);
    expect(sent.some((t) => t.includes("publish skipped"))).toBe(true);
  });

  it("publishFromBank returns false, sends nothing, and leaves the bank untouched when a round already exists for that date", async () => {
    const { db } = await makeTestDb();
    // Any status — including one decideActions' snapshot couldn't have seen
    // coming (e.g. locked/resolved same-day) — must stop this before it
    // burns a bank entry or fires telegram noise.
    await db.insert(schema.rounds).values({ date: "2026-08-27", status: "resolved" });
    const [entry] = await db
      .insert(schema.draftBank)
      .values({ draft: validDraft, createdAt: new Date("2026-08-20T00:00:00Z") })
      .returning({ id: schema.draftBank.id });
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:00:00Z");
    const published = await publishFromBank(db, deps.telegram, "2026-08-27");
    expect(published).toBe(false);
    expect(sent.length).toBe(0);
    const row = await db.query.draftBank.findFirst({ where: eq(schema.draftBank.id, entry!.id) });
    expect(row!.usedOn).toBeNull();
  });

  it("publishFromBank skips poisoned entries within a single call and still publishes the first good one", async () => {
    const { db } = await makeTestDb();
    const poisoned = { questions: [] }; // trivially fails DraftSchema
    await db.insert(schema.draftBank).values([
      { draft: poisoned, createdAt: new Date("2026-08-20T00:00:00Z") },
      { draft: poisoned, createdAt: new Date("2026-08-21T00:00:00Z") },
      { draft: validDraft, createdAt: new Date("2026-08-22T00:00:00Z") },
    ]);
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:00:00Z");

    const published = await publishFromBank(db, deps.telegram, "2026-08-27");

    expect(published).toBe(true);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round!.status).toBe("open");
    const rows = await db.query.draftBank.findMany();
    expect(rows.every((r) => r.usedOn === "2026-08-27")).toBe(true); // all three burned this tick
    expect(sent.filter((t) => t.includes("failed validation and was skipped")).length).toBe(2);
    expect(sent.some((t) => t.includes("published from the evergreen bank"))).toBe(true);
  });

  it("publishFromBank burns an entry that passes the schema but cannot be scheduled", async () => {
    // A stale absolute instant ("resolves_at out of range") or a weather
    // question is valid JSON and valid DraftSchema, but upsertDraft throws on
    // it. That throw used to escape the loop, leaving the row unmarked so it
    // jammed every subsequent tick — on the one path whose whole purpose is
    // that the noon drop never fails.
    const { db } = await makeTestDb();
    const stale = {
      ...validDraft,
      questions: validDraft.questions.map((q, i) =>
        i === 0 ? { ...q, resolves_at: "2020-01-01T00:00:00.000Z" } : q,
      ),
    };
    await db.insert(schema.draftBank).values([
      { draft: stale, createdAt: new Date("2026-08-20T00:00:00Z") },
      { draft: validDraft, createdAt: new Date("2026-08-21T00:00:00Z") },
    ]);
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:00:00Z");

    const published = await publishFromBank(db, deps.telegram, "2026-08-27");

    expect(published).toBe(true);
    const rows = await db.query.draftBank.findMany();
    expect(rows.every((r) => r.usedOn === "2026-08-27")).toBe(true); // the poisoned row is burned, not left to jam
    expect(sent.some((t) => t.includes("could not be scheduled and was skipped"))).toBe(true);
    expect(sent.some((t) => t.includes("published from the evergreen bank"))).toBe(true);
  });

  it("publishFromBank bounds its retries per tick so a wholly-corrupt bank can't spin", async () => {
    const { db } = await makeTestDb();
    const poisoned = { questions: [] };
    await db.insert(schema.draftBank).values(
      Array.from({ length: 7 }, (_, i) => ({ draft: poisoned, createdAt: new Date(2026, 7, 20 + i) })),
    );
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:00:00Z");

    const published = await publishFromBank(db, deps.telegram, "2026-08-27");

    expect(published).toBe(false);
    const rows = await db.query.draftBank.findMany();
    expect(rows.filter((r) => r.usedOn === "2026-08-27").length).toBe(5); // bounded, not all 7
    expect(sent.filter((t) => t.includes("failed validation and was skipped")).length).toBe(5);
  });
});

describe("voidQuestions", () => {
  it("skips a question already resolved by a concurrent tick", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-26"));
    const [already, stillLocked] = qs;

    // Simulate: a concurrent resolveWithClaude finished for `already` in
    // between decideActions snapshotting the locked ids and voidQuestions
    // actually running.
    await resolveQuestion(db, already!.id, "yes");

    const { deps, sent } = fakeDeps(db, "2026-08-27T17:15:00Z");
    await voidQuestions(db, deps.telegram, [already!.id, stillLocked!.id], "2026-08-27T17:15:00Z");

    const rows = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-26") });
    const alreadyRow = rows.find((r) => r.id === already!.id)!;
    const lockedRow = rows.find((r) => r.id === stillLocked!.id)!;

    expect(alreadyRow.status).toBe("resolved");
    expect(alreadyRow.outcome).toBe("yes"); // untouched, not overwritten to void
    expect(lockedRow.status).toBe("void");

    expect(sent.length).toBe(1);
    expect(sent[0]).toContain(lockedRow.text);
    expect(sent[0]).not.toContain(alreadyRow.text);
  });

  it("sends no WARN when every targeted question is already resolved", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-26"));
    const q = qs[0]!;
    await resolveQuestion(db, q.id, "yes");

    const { deps, sent } = fakeDeps(db, "2026-08-27T17:15:00Z");
    await voidQuestions(db, deps.telegram, [q.id], "2026-08-27T17:15:00Z");

    expect(sent.length).toBe(0);
  });
});

function baseEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    DEVICE_TOKEN_SECRET: "s",
    ADMIN_SECRET: "s",
    ...overrides,
  };
}

describe("buildPipelineDeps", () => {
  it("is undefined when PIPELINE_ENABLED is unset", () => {
    expect(buildPipelineDeps(baseEnv())).toBeUndefined();
  });

  it("is undefined when PIPELINE_ENABLED is not exactly \"true\"", () => {
    expect(buildPipelineDeps(baseEnv({ PIPELINE_ENABLED: "1" }))).toBeUndefined();
    expect(buildPipelineDeps(baseEnv({ PIPELINE_ENABLED: "TRUE" }))).toBeUndefined();
  });

  it("is defined with claude null when only PIPELINE_ENABLED=true is set", () => {
    const deps = buildPipelineDeps(baseEnv({ PIPELINE_ENABLED: "true" }));
    expect(deps).toBeDefined();
    expect(deps!.claude).toBeNull();
  });

  it("gives claude a client when ANTHROPIC_API_KEY is set", () => {
    const deps = buildPipelineDeps(
      baseEnv({ PIPELINE_ENABLED: "true", ANTHROPIC_API_KEY: "sk-test" }),
    );
    expect(deps!.claude).not.toBeNull();
  });

  it("defaults models to the standard author/resolve constants", () => {
    const deps = buildPipelineDeps(baseEnv({ PIPELINE_ENABLED: "true" }));
    expect(deps!.models).toEqual({ author: "claude-opus-5", resolve: "claude-sonnet-5", forecast: "claude-sonnet-5" });
  });

  it("honors PIPELINE_AUTHOR_MODEL / PIPELINE_RESOLVE_MODEL overrides", () => {
    const deps = buildPipelineDeps(
      baseEnv({
        PIPELINE_ENABLED: "true",
        PIPELINE_AUTHOR_MODEL: "claude-opus-custom",
        PIPELINE_RESOLVE_MODEL: "claude-sonnet-custom",
      }),
    );
    expect(deps!.models).toEqual({ author: "claude-opus-custom", resolve: "claude-sonnet-custom", forecast: "claude-sonnet-5" });
  });

  it("telegram client is present (no-op) even without bot token/chat id", () => {
    const deps = buildPipelineDeps(baseEnv({ PIPELINE_ENABLED: "true" }));
    expect(deps!.telegram).toBeDefined();
    expect(typeof deps!.telegram.send).toBe("function");
  });
});
