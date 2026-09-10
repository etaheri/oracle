import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { schema } from "../src/db/client";
import { runMarketRound, fetchCandidates, buildMarketDraft } from "../src/pipeline/market-round";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { ExchangeFeed, MarketCandidate } from "../src/pipeline/exchanges/types";
import { noonET, addDays } from "../src/pipeline/clock";

// Authoring runs the evening BEFORE the round date (now is Sept 10, 21:05Z; the
// round is Sept 11), so a context stamped "now" predates the round's opening.
const DATE = "2026-09-11";
const lock = noonET(addDays(DATE, 1));
const h = (n: number) => new Date(lock.getTime() + n * 3_600_000).toISOString();

function cand(id: string, category: MarketCandidate["category"], volume: number, over: Partial<MarketCandidate> = {}): MarketCandidate {
  return {
    source: "kalshi", marketId: id, eventKey: `E-${id}`, seriesKey: "KXT", title: `Will ${id} happen on Friday?`,
    rules: "Resolves per the exchange rules for this market.", url: "https://kalshi.com/markets/kxt", category, prob: 0.4, volume, closesAt: h(10), ...over,
  };
}
const feedOf = (rows: MarketCandidate[], source: ExchangeFeed["source"] = "kalshi"): ExchangeFeed => ({
  source, list: async () => rows, read: async () => ({ settled: false, outcome: null, raw: null }),
});

const SEVEN = [
  cand("nfl", "sports", 240_000), cand("btc", "markets", 200_000), cand("kbo", "sports", 107_000), cand("bb", "culture", 41_000),
  cand("cpi", "news", 35_000), cand("eth", "markets", 11_000), cand("nyc", "weather", 8_400),
];

// A canned Claude: the voice call echoes titles as questions; the taste call allows everything unless told otherwise.
function claudeWith(opts: { refuse?: string[]; calls: string[] }): NonNullable<PipelineDeps["claude"]> {
  return {
    async structured(call) {
      opts.calls.push(call.schemaName);
      if (call.schemaName === "oracle_voice") {
        const slots = [...call.user.matchAll(/\[slot (\d)[^\]]*\]\nTITLE: (.+)/g)];
        return { questions: slots.map((m) => ({ slot: Number(m[1]), text: m[2]!.trim(), context: "Some background." })) };
      }
      if (call.schemaName === "taste_verdicts") {
        const lines = call.user.split("\n").filter((l) => /^\[\d+\]/.test(l));
        return { verdicts: lines.map((l, i) => ({ index: i, allowed: !(opts.refuse ?? []).some((r) => l.includes(r)), reason: "" })) };
      }
      throw new Error(`unexpected call ${call.schemaName}`);
    },
  };
}

async function depsWith(feeds: ExchangeFeed[], claude: PipelineDeps["claude"], sent: string[]): Promise<PipelineDeps> {
  const { db } = await makeTestDb();
  return {
    db, telegram: { send: async (t) => { sent.push(t); } }, claude,
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", critic: "c", preflight: "p", probe: "pr", taste: "t", voice: "v" },
    now: () => new Date("2026-09-10T21:05:00Z"),
    workflows: inlineStarter(),
    exchangeFeeds: feeds,
    marketFetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch,
  };
}

describe("fetchCandidates", () => {
  it("pools every feed and applies eligibility against tomorrow's lock", async () => {
    const deps = await depsWith([feedOf(SEVEN), feedOf([cand("poly", "news", 50_000, { source: "polymarket", closesAt: h(1) })], "polymarket")], claudeWith({ calls: [] }), []);
    const out = await fetchCandidates(deps, DATE);
    expect(out.map((c) => c.marketId)).toEqual(["nfl", "btc", "kbo", "bb", "cpi", "eth", "nyc"]); // poly closes inside the window
  });
});

describe("runMarketRound", () => {
  it("publishes a version 3 draft: five questions, voiced, market columns stamped, narrated once", async () => {
    const calls: string[] = []; const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r).toMatchObject({ published: true, fetched: 7, eligible: 7, reason: null });
    expect(calls).toEqual(["oracle_voice", "taste_verdicts"]);
    const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.rulesVersion).toBe(3);
    expect(round!.status).toBe("scheduled");
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.map((q) => q.marketId)).toEqual(["btc", "bb", "cpi", "nyc", "nfl"]);
    expect(qs[4]!.isBigOne).toBe(true);
    expect(qs.every((q) => q.marketSource === "kalshi" && q.linePYes === null && Number(q.marketProb) === 0.4)).toBe(true);
    expect(qs[0]!.text).toBe("Will btc happen on Friday?");
    expect(qs[0]!.resolutionCriteria).toContain("exchange rules");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("2026-09-11");
    expect(sent[0]).toContain("5 published");
  });
  it("drops a market the taste gate refuses, re-selects once, and publishes", async () => {
    const calls: string[] = []; const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls, refuse: ["bb happen"] }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r.published).toBe(true);
    expect(calls).toEqual(["oracle_voice", "taste_verdicts", "oracle_voice", "taste_verdicts"]);
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE) });
    expect(qs.map((q) => q.marketId)).not.toContain("bb");
  });
  it("falls to the bank (publishes nothing) under five eligible markets, and says so", async () => {
    const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN.slice(0, 4))], claudeWith({ calls: [] }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r).toMatchObject({ published: false, eligible: 4 });
    expect(r.reason).toMatch(/4 eligible/);
    expect(await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) })).toBeUndefined();
    expect(sent[0]).toContain("bank covers noon");
  });
  it("publishes nothing when a second taste refusal empties the round", async () => {
    const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls: [], refuse: ["happen"] }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toMatch(/taste/);
  });
  it("does not touch a round that is already committed", async () => {
    const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls: [] }), sent);
    await runMarketRound(deps, DATE);
    await deps.db.update(schema.rounds).set({ oracleCommittedAt: new Date() }).where(eq(schema.rounds.date, DATE));
    const r = await runMarketRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toMatch(/not editable/);
  });
});

describe("buildMarketDraft", () => {
  it("clamps the author probability into the draft's band and carries the market", async () => {
    const deps = await depsWith([], claudeWith({ calls: [] }), []);
    const { draft } = await buildMarketDraft(deps, DATE, SEVEN.map((c) => ({ ...c, prob: 0.22 })));
    expect(draft!.questions.every((q) => q.author_probability === 0.3 && q.market_prob === 0.22 && q.market?.source === "kalshi")).toBe(true);
  });
});
