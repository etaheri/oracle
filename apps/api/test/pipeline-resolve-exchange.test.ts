import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { resolveOne, resolveFromExchange } from "../src/pipeline/resolve";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { ExchangeFeed, SettlementRead } from "../src/pipeline/exchanges/types";

const DATE = "2026-09-10";
async function depsWith(read: (id: string) => Promise<SettlementRead>, claudeCalls: string[]): Promise<{ deps: PipelineDeps; qId: string }> {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3, status: "locked" }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, DATE));
  await db.update(schema.questions).set({ marketSource: "kalshi", marketId: "KXT-1", marketEventKey: "KXT", linePYes: "0.4" }).where(eq(schema.questions.id, rows[0]!.id));
  const feed: ExchangeFeed = { source: "kalshi", list: async () => [], read: (_f, id) => read(id) };
  const deps: PipelineDeps = {
    db, telegram: { send: async () => {} },
    claude: { structured: async (call) => { claudeCalls.push(call.schemaName); return { outcome: "unverifiable", quotes: [], reasoning: "" }; } },
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", taste: "t", voice: "v" },
    now: () => new Date("2026-09-12T01:00:00Z"), workflows: inlineStarter(), exchangeFeeds: [feed],
    marketFetch: (async () => { throw new Error("no network"); }) as unknown as typeof fetch,
  };
  return { deps, qId: rows[0]!.id };
}

describe("resolveFromExchange", () => {
  it("resolves a settled yes and stores the exchange record as evidence", async () => {
    const { deps, qId } = await depsWith(async (id) => ({ settled: true, outcome: "yes", raw: { ticker: id, status: "finalized", result: "yes" } }), []);
    expect(await resolveFromExchange(deps, qId)).toBe(true);
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("resolved");
    expect(q!.outcome).toBe("yes");
    expect(q!.resolutionEvidence).toMatchObject({ source: "kalshi", market_id: "KXT-1", outcome: "yes", raw: { result: "yes" } });
  });
  it("leaves an unsettled market locked", async () => {
    const { deps, qId } = await depsWith(async () => ({ settled: false, outcome: null, raw: {} }), []);
    expect(await resolveFromExchange(deps, qId)).toBe(false);
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("locked");
  });
  it("voids what the exchange voided", async () => {
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "void", raw: {} }), []);
    await resolveFromExchange(deps, qId);
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("void");
  });
  it("throws when the question's source has no feed", async () => {
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "yes", raw: {} }), []);
    await deps.db.update(schema.questions).set({ marketSource: "polymarket" }).where(eq(schema.questions.id, qId));
    await expect(resolveFromExchange(deps, qId)).rejects.toThrow(/no feed for polymarket/);
  });
});

describe("resolveOne", () => {
  it("routes a market question to the exchange and never calls a model", async () => {
    const calls: string[] = [];
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "no", raw: {} }), calls);
    const r = await resolveOne(deps, qId);
    expect(r.resolved).toBe(true);
    expect(calls).toEqual([]);
  });
  it("captures a read failure into the outcome instead of throwing", async () => {
    const { deps, qId } = await depsWith(async () => { throw new Error("503 from kalshi"); }, []);
    const r = await resolveOne(deps, qId);
    expect(r.resolved).toBe(false);
    expect(r.error).toMatch(/503/);
  });
  it("still routes an authored question to the model resolver", async () => {
    const calls: string[] = [];
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "no", raw: {} }), calls);
    await deps.db.update(schema.questions).set({ marketSource: null, marketId: null }).where(eq(schema.questions.id, qId));
    await resolveOne(deps, qId);
    expect(calls).toEqual(["resolution", "resolution"]);
  });
});
