import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { stampOracleForecast } from "../src/pipeline/forecast";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";

type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

// Harness mirrors pipeline-author.test.ts's makeTestDb/fakeDeps conventions.
// The Claude client is always injected — stampOracleForecast must never make
// a live network call in a test.
function makeDeps(
  db: TestDb,
  opts: { claude: { structured: ClaudeClient["structured"] } | null },
): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    claude: opts.claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    telegram: { send: async () => {} },
    now: () => new Date("2099-09-03T12:00:00Z"),
    // Feeds must never reach the network in tests.
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
}

async function seedScheduledRound(db: TestDb, date: string, opts: { authorProb?: string } = {}) {
  const opensAt = new Date(`${date}T16:00:00Z`);
  const locksAt = new Date(opensAt.getTime() + 86_400_000);
  await seedRound(db, { date, opensAt, locksAt });
  await db.update(schema.rounds).set({ status: "scheduled" }).where(eq(schema.rounds.date, date));
  await db.update(schema.questions).set({ status: "scheduled" }).where(eq(schema.questions.roundDate, date));
  if (opts.authorProb !== undefined) {
    await db
      .update(schema.questions)
      .set({ authorProb: opts.authorProb })
      .where(eq(schema.questions.roundDate, date));
  }
}

// 20 players, all YES at 95 — a real, lopsided crowd sealed into the DB
// between two forecast calls, to prove the prompt never depends on it.
async function sealLopsidedCrowd(db: TestDb, date: string) {
  const questions = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const users = await db
    .insert(schema.users)
    .values(Array.from({ length: 20 }, () => ({})))
    .returning({ id: schema.users.id });
  for (const q of questions) {
    await db.insert(schema.predictions).values(
      users.map((u) => ({ questionId: q.id, userId: u.id, answer: true, confidence: 95 })),
    );
  }
}

const fiveSlots = [
  { slot: 1, p_yes: 0.62 }, { slot: 2, p_yes: 0.31 }, { slot: 3, p_yes: 0.5 },
  { slot: 4, p_yes: 0.88 }, { slot: 5, p_yes: 0.44 },
];

describe("stampOracleForecast", () => {
  it("stamps every question's oracle_p_yes from one structured call", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    const deps = makeDeps(db, { claude: { structured } });
    await seedScheduledRound(db, "2099-09-03");

    await stampOracleForecast(deps, "2099-09-03");

    const rows = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, "2099-09-03"),
    });
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2099-09-03") });
    expect(round?.oracleCommittedAt).toBeInstanceOf(Date);
    expect(round?.oracleForecastModel).toBe("m-f");
    expect(round?.oraclePromptVersion).toBe("forecast-v2");
    expect(round?.oracleForecastSnapshot).toBeTruthy();
    expect(structured).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => Number(r.oracleProbYes)).sort()).toEqual([0.31, 0.44, 0.5, 0.62, 0.88]);
  });

  it("builds identical prompts before and after crowd activity on independent rounds", async () => {
    const calls: { system: string; user: string }[] = [];
    for (const withCrowd of [false, true]) {
      const { db } = await makeTestDb();
      await seedScheduledRound(db, "2099-09-03");
      if (withCrowd) await sealLopsidedCrowd(db, "2099-09-03");
      const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
      const forecast = stampOracleForecast(makeDeps(db, { claude: { structured } }), "2099-09-03");
      if (withCrowd) {
        await expect(forecast).rejects.toThrow();
        expect((await db.query.questions.findMany()).every(q => q.oracleProbYes === null)).toBe(true);
      } else await forecast;
      calls.push(structured.mock.calls[0]![0]);
    }
    expect(calls[0]!.system).toBe(calls[1]!.system);
    expect(calls[0]!.user).toBe(calls[1]!.user);
  });

  it("never shows the forecaster the author's own probability", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    const deps = makeDeps(db, { claude: { structured } });
    await seedScheduledRound(db, "2099-09-03", { authorProb: "0.42" });
    await stampOracleForecast(deps, "2099-09-03");
    const call = structured.mock.calls[0]![0];
    expect(`${call.system}${call.user}`).not.toContain("0.42");
    expect(`${call.system}${call.user}`.toLowerCase()).not.toContain("author_prob");
  });

  it("leaves the round unstamped when the call fails", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockRejectedValue(new Error("claude: 529"));
    const deps = makeDeps(db, { claude: { structured } });
    await seedScheduledRound(db, "2099-09-03");
    await expect(stampOracleForecast(deps, "2099-09-03")).rejects.toThrow();
    const rows = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, "2099-09-03"),
    });
    expect(rows.every((r) => r.oracleProbYes === null)).toBe(true);
  });

  it("rejects a response missing a slot rather than stamping a partial round", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockResolvedValue({ forecasts: [{ slot: 1, p_yes: 0.6 }] });
    const deps = makeDeps(db, { claude: { structured } });
    await seedScheduledRound(db, "2099-09-03");
    await expect(stampOracleForecast(deps, "2099-09-03")).rejects.toThrow(/validation|slot/i);
  });
  it("treats an existing commitment as a no-op, including without a client", async () => {
    const { db } = await makeTestDb();
    await seedScheduledRound(db, "2099-09-03");
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    const deps = makeDeps(db, { claude: { structured } });
    await stampOracleForecast(deps, "2099-09-03");
    const before = await db.query.questions.findMany();
    await stampOracleForecast(deps, "2099-09-03");
    await stampOracleForecast(makeDeps(db, { claude: null }), "2099-09-03");
    expect(structured).toHaveBeenCalledTimes(1);
    expect(await db.query.questions.findMany()).toEqual(before);
  });

  it.each(["round open", "question open", "at opening", "after opening", "missing question", "invalid slot", "legacy partial"])(
    "refuses %s before calling the model", async (condition) => {
      const { db } = await makeTestDb();
      await seedScheduledRound(db, "2099-09-03");
      const rows = await db.query.questions.findMany();
      const first = rows[0]!;
      const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
      const deps = makeDeps(db, { claude: { structured } });
      if (condition === "round open") await db.update(schema.rounds).set({ status: "open" });
      if (condition === "question open") await db.update(schema.questions).set({ status: "open" }).where(eq(schema.questions.id, first.id));
      if (condition === "at opening") deps.now = () => new Date("2099-09-03T16:00:00Z");
      if (condition === "after opening") deps.now = () => new Date("2099-09-03T16:00:01Z");
      if (condition === "missing question") await db.delete(schema.questions).where(eq(schema.questions.id, first.id));
      if (condition === "invalid slot") await db.update(schema.questions).set({ slot: 6 }).where(eq(schema.questions.id, first.id));
      if (condition === "legacy partial") await db.update(schema.questions).set({ oracleProbYes: "0.7" }).where(eq(schema.questions.id, first.id));
      const before = await db.query.questions.findMany();
      await expect(stampOracleForecast(deps, "2099-09-03")).rejects.toThrow();
      expect(structured).not.toHaveBeenCalled();
      expect(await db.query.questions.findMany()).toEqual(before);
    },
  );

  it("rejects duplicate response slots without writing any probability", async () => {
    const { db } = await makeTestDb();
    await seedScheduledRound(db, "2099-09-03");
    const structured = vi.fn().mockResolvedValue({ forecasts: [...fiveSlots, fiveSlots[0]] });
    await expect(stampOracleForecast(makeDeps(db, { claude: { structured } }), "2099-09-03")).rejects.toThrow();
    expect((await db.query.questions.findMany()).every(q => q.oracleProbYes === null)).toBe(true);
  });

  it.each(["clock", "publish", "text", "criteria", "source", "context", "timing", "id"])(
    "rejects %s changing during the model call without a partial commit", async (change) => {
      const { db } = await makeTestDb();
      await seedScheduledRound(db, "2099-09-03");
      const first = (await db.query.questions.findMany())[0]!;
      const structured = vi.fn().mockImplementation(async () => {
        if (change === "clock") deps.now = () => new Date("2099-09-03T16:00:00Z");
        if (change === "publish") await db.update(schema.rounds).set({ status: "open" });
        if (change === "text") await db.update(schema.questions).set({ text: "Changed?" }).where(eq(schema.questions.id, first.id));
        if (change === "criteria") await db.update(schema.questions).set({ resolutionCriteria: "Changed" }).where(eq(schema.questions.id, first.id));
        if (change === "source") await db.update(schema.questions).set({ sourceUrl: "https://example.com/changed" }).where(eq(schema.questions.id, first.id));
        if (change === "context") await db.update(schema.questions).set({ context: { text: "Changed", asOf: "2099-09-03", sourceUrl: "https://example.com" } }).where(eq(schema.questions.id, first.id));
        if (change === "timing") await db.update(schema.questions).set({ locksAt: new Date("2099-09-05T16:00:00Z") }).where(eq(schema.questions.id, first.id));
        if (change === "id") {
          await db.delete(schema.questions).where(eq(schema.questions.id, first.id));
          const { id: _id, ...replacement } = first;
          await db.insert(schema.questions).values(replacement);
        }
        return { forecasts: fiveSlots };
      });
      const deps = makeDeps(db, { claude: { structured } });
      await expect(stampOracleForecast(deps, "2099-09-03")).rejects.toThrow();
      expect((await db.query.questions.findMany()).every(q => q.oracleProbYes === null)).toBe(true);
      expect((await db.query.rounds.findFirst())?.oracleCommittedAt).toBeNull();
    },
  );

  it("enforces the database clock even if the application clock claims it is early", async () => {
    const { db } = await makeTestDb();
    await seedScheduledRound(db, "2099-09-03");
    await db.update(schema.questions).set({ opensAt: new Date("2000-09-03T16:00:00Z") });
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    const deps = makeDeps(db, { claude: { structured } });
    deps.now = () => new Date("2000-09-03T12:00:00Z");
    await expect(stampOracleForecast(deps, "2099-09-03")).rejects.toThrow();
    expect((await db.query.questions.findMany()).every(q => q.oracleProbYes === null)).toBe(true);
  });

  it("commits one complete forecast when two jobs race", async () => {
    const { db } = await makeTestDb();
    await seedScheduledRound(db, "2099-09-03");
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let entered = 0;
    const other = fiveSlots.map(f => ({ ...f, p_yes: 0.12 }));
    const structured = vi.fn().mockImplementation(async () => {
      const mine = ++entered === 1 ? fiveSlots : other;
      if (entered === 2) release();
      await barrier;
      return { forecasts: mine };
    });
    const deps = makeDeps(db, { claude: { structured } });
    const results = await Promise.allSettled([stampOracleForecast(deps, "2099-09-03"), stampOracleForecast(deps, "2099-09-03")]);
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    const rows = await db.query.questions.findMany({ orderBy: (q, { asc }) => [asc(q.slot)] });
    const probabilities = rows.map(q => Number(q.oracleProbYes));
    expect([fiveSlots.map(f => f.p_yes), other.map(f => f.p_yes)]).toContainEqual(probabilities);
    expect((await db.query.rounds.findFirst())?.oracleCommittedAt).toBeInstanceOf(Date);
  });

  it("guards committed questions and metadata while allowing settlement", async () => {
    const { db } = await makeTestDb();
    await seedScheduledRound(db, "2099-09-03");
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    await stampOracleForecast(makeDeps(db, { claude: { structured } }), "2099-09-03");
    await expect(db.update(schema.questions).set({ oracleProbYes: "0.01" })).rejects.toThrow();
    await expect(db.update(schema.questions).set({ sourceName: "new source" })).rejects.toThrow();
    await expect(db.delete(schema.questions)).rejects.toThrow();
    await expect(db.update(schema.rounds).set({ oracleCommittedAt: null })).rejects.toThrow();
    await db.update(schema.questions).set({ status: "open" });
    await expect(db.update(schema.questions).set({ locksAt: new Date("2099-09-05T16:00:00Z") })).rejects.toThrow();
    await db.update(schema.questions).set({ locksAt: new Date("2099-09-04T12:00:00Z"), lockHealedAt: new Date("2099-09-04T12:00:00Z") });
    await db.update(schema.questions).set({ status: "resolved", outcome: "yes", resolvedAt: new Date("2099-09-05T16:00:00Z") });
    expect((await db.query.questions.findMany()).every(q => q.outcome === "yes")).toBe(true);
  });

});
