import { describe, expect, it } from "vitest";
import { fetchMarketSignals, rankSignals, MANIFOLD_FEED, POLYMARKET_FEED, type MarketSignal } from "../src/pipeline/feeds";

const NOW = new Date("2026-08-27T22:00:00Z");
const IN_12H = new Date("2026-08-28T10:00:00Z").getTime();

const manifoldBody = JSON.stringify([
  { question: "Will the Fed cut rates tomorrow?", probability: 0.42, closeTime: IN_12H, volume: 5400, uniqueBettorCount: 40, outcomeType: "BINARY", url: "https://manifold.markets/x/fed" },
  { question: "Too few bettors", probability: 0.5, closeTime: IN_12H, volume: 90, uniqueBettorCount: 2, outcomeType: "BINARY", url: "https://manifold.markets/x/thin" },
  { question: "Closes too far out", probability: 0.5, closeTime: NOW.getTime() + 90 * 3_600_000, volume: 9000, uniqueBettorCount: 50, outcomeType: "BINARY", url: "https://manifold.markets/x/far" },
  { question: "Multiple choice thing", closeTime: IN_12H, volume: 9000, uniqueBettorCount: 50, outcomeType: "MULTIPLE_CHOICE", url: "https://manifold.markets/x/mc" },
]);

const polymarketBody = JSON.stringify([
  { question: "Will bitcoin close above $130k Friday?", outcomePrices: '["0.38", "0.62"]', endDate: new Date(IN_12H).toISOString(), volume: "250000.5", liquidity: "80000", slug: "btc-130k" },
  { question: "Thin market", outcomePrices: '["0.5", "0.5"]', endDate: new Date(IN_12H).toISOString(), volume: "40", liquidity: "10", slug: "thin" },
  { question: "Unparseable prices", outcomePrices: "not-json", endDate: new Date(IN_12H).toISOString(), volume: "9000", slug: "bad" },
]);

function fakeFetch(bodies: Record<string, string | number>) {
  const calls: string[] = [];
  const fn = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    for (const [host, body] of Object.entries(bodies)) {
      if (u.includes(host)) {
        return typeof body === "number" ? new Response("err", { status: body }) : new Response(body, { status: 200 });
      }
    }
    throw new Error("no route");
  }) as typeof fetch;
  return { fn, calls };
}

describe("market feeds", () => {
  it("manifold: keeps binary, contested-window, sufficiently-bet markets inside the horizon", async () => {
    const { fn } = fakeFetch({ "manifold.markets": manifoldBody });
    const out = await MANIFOLD_FEED.fetch(fn, NOW, 36 * 3_600_000);
    expect(out.map((s) => s.question)).toEqual(["Will the Fed cut rates tomorrow?"]);
    expect(out[0]).toMatchObject({ source: "manifold", prob: 0.42, url: "https://manifold.markets/x/fed" });
  });

  it("polymarket: parses outcomePrices, applies volume floor, skips unparseable rows", async () => {
    const { fn } = fakeFetch({ "gamma-api.polymarket.com": polymarketBody });
    const out = await POLYMARKET_FEED.fetch(fn, NOW, 36 * 3_600_000);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ source: "polymarket", prob: 0.38, question: "Will bitcoin close above $130k Friday?" });
    expect(out[0]!.url).toContain("polymarket.com");
  });

  it("a failing feed is isolated: the other still delivers", async () => {
    const { fn } = fakeFetch({ "manifold.markets": manifoldBody, "gamma-api.polymarket.com": 500 });
    const { signals, failures } = await fetchMarketSignals(fn, NOW);
    expect(signals.some((s) => s.source === "manifold")).toBe(true);
    expect(failures).toEqual(["polymarket"]);
  });

  it("all feeds failing yields empty signals, never a throw", async () => {
    const fn = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const { signals, failures } = await fetchMarketSignals(fn, NOW);
    expect(signals).toEqual([]);
    expect(failures.sort()).toEqual(["manifold", "polymarket"]);
  });
});

describe("rankSignals", () => {
  const sig = (q: string, source: MarketSignal["source"], prob: number, volume: number): MarketSignal =>
    ({ question: q, source, prob, volume, closesAt: new Date(IN_12H).toISOString(), url: "https://x" });

  it("drops uncontested probabilities and caps the list", () => {
    const signals = [
      sig("sure thing", "polymarket", 0.97, 1e6),
      ...Array.from({ length: 20 }, (_, i) => sig(`q${i}`, "polymarket", 0.5, 1000 + i)),
    ];
    const ranked = rankSignals(signals);
    expect(ranked.length).toBe(15);
    expect(ranked.some((s) => s.question === "sure thing")).toBe(false);
  });

  it("real money outranks play money at equal contestedness and volume", () => {
    const ranked = rankSignals([sig("mana", "manifold", 0.5, 5000), sig("usd", "polymarket", 0.5, 5000)]);
    expect(ranked[0]!.question).toBe("usd");
  });

  it("closer-to-coin-flip outranks the edges within a source", () => {
    const ranked = rankSignals([sig("edge", "polymarket", 0.75, 5000), sig("flip", "polymarket", 0.5, 5000)]);
    expect(ranked[0]!.question).toBe("flip");
  });
});
