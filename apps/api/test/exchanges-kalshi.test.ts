import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KALSHI_FEED, kalshiCategory } from "../src/pipeline/exchanges/kalshi";

const __dirname = dirname(fileURLToPath(import.meta.url));

const fx = (name: string) => readFileSync(join(__dirname, "fixtures/exchanges", name), "utf8");

// A fetch stub keyed on URL substrings. Unmatched URLs throw, so a test that
// reaches an endpoint it did not expect fails loudly instead of returning [].
function fetchFrom(routes: Array<[string, string]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([needle]) => url.includes(needle));
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    return new Response(hit[1], { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("KALSHI_FEED.list", () => {
  const window = { from: new Date("2026-09-11T18:00:00Z"), to: new Date("2026-09-12T22:00:00Z") };
  it("pages by cursor, reads dollar prices, drops exotics and unpriced rows", async () => {
    const calls: string[] = [];
    const f = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return fetchFrom([["cursor=PAGE2", fx("kalshi-markets-page2.json")], ["/markets?", fx("kalshi-markets-page1.json")]])(input);
    }) as typeof fetch;
    const out = await KALSHI_FEED.list(f, window);
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("min_close_ts=");
    expect(calls[0]).toContain("max_close_ts=");
    expect(out.every((m) => m.source === "kalshi")).toBe(true);
    expect(out.every((m) => m.prob > 0 && m.prob < 1)).toBe(true);
    expect(out.some((m) => m.marketId.startsWith("KXMVE"))).toBe(false);
    // page 2 repeats five rows from page 1; de-duplicated by ticker
    const ids = out.map((m) => m.marketId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("maps each row's fields", async () => {
    const out = await KALSHI_FEED.list(fetchFrom([["cursor=PAGE2", fx("kalshi-markets-page2.json")], ["/markets?", fx("kalshi-markets-page1.json")]]), window);
    const m = out[0]!;
    expect(m.eventKey).toMatch(/^KX/);
    expect(m.seriesKey).toBe(m.eventKey.split("-")[0]);
    expect(m.url).toBe(`https://kalshi.com/markets/${m.seriesKey.toLowerCase()}`);
    expect(typeof m.rules).toBe("string");
    expect(Date.parse(m.closesAt)).not.toBeNaN();
  });
});

describe("KALSHI_FEED.read", () => {
  it("reads a finalized yes", async () => {
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", fx("kalshi-market-settled-yes.json")]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "yes" });
  });
  it("reads a finalized no", async () => {
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", fx("kalshi-market-settled-no.json")]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "no" });
  });
  it("an open market is not settled", async () => {
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", fx("kalshi-market-open.json")]]), "ANY");
    expect(r).toMatchObject({ settled: false, outcome: null });
  });
  it("a determined-but-not-finalized market with a result counts as settled", async () => {
    const body = JSON.parse(fx("kalshi-market-settled-yes.json"));
    body.market.status = "determined";
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", JSON.stringify(body)]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "yes" });
  });
  it("a finalized market with an unknown result is a void", async () => {
    const body = JSON.parse(fx("kalshi-market-settled-yes.json"));
    body.market.result = "scratch";
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", JSON.stringify(body)]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "void" });
  });
  it("a non-200 throws", async () => {
    const f = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(KALSHI_FEED.read(f, "ANY")).rejects.toThrow(/503/);
  });
});

describe("kalshiCategory", () => {
  it("prefers the event category when given", () => {
    expect(kalshiCategory("KXHIGHNY", "Climate and Weather")).toBe("weather");
    expect(kalshiCategory("KXNFLGAME", "Sports")).toBe("sports");
    expect(kalshiCategory("KXBIGBROTHERELIMINATION", "Entertainment")).toBe("culture");
    expect(kalshiCategory("KXBTCD", "Financials")).toBe("markets");
    expect(kalshiCategory("KXCPI", "Economics")).toBe("news");
    expect(kalshiCategory("KXAPRPOTUS", "Politics")).toBe("news");
  });
  it("falls back to the series prefix table, then to news", () => {
    expect(kalshiCategory("KXHIGHCHI")).toBe("weather");
    expect(kalshiCategory("KXRAIN")).toBe("weather");
    expect(kalshiCategory("KXETHD")).toBe("markets");
    expect(kalshiCategory("KXNASDAQ100U")).toBe("markets");
    expect(kalshiCategory("KXKBOGAME")).toBe("sports");
    expect(kalshiCategory("KXWFIBASPREAD")).toBe("sports");
    expect(kalshiCategory("KXSOMETHINGNEW")).toBe("news");
  });
});
