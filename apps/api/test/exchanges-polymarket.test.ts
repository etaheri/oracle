import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { POLYMARKET_FEED, polymarketCategory } from "../src/pipeline/exchanges/polymarket";

const __dirname = dirname(fileURLToPath(import.meta.url));

const fx = (name: string) => readFileSync(join(__dirname, "fixtures/exchanges", name), "utf8");
function fetchFrom(routes: Array<[string, string]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([needle]) => url.includes(needle));
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    return new Response(hit[1], { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("POLYMARKET_FEED.list", () => {
  const window = { from: new Date("2026-09-11T18:00:00Z"), to: new Date("2026-09-12T22:00:00Z") };
  it("stops at a short page, sends a browser user agent, maps fields", async () => {
    const calls: Array<{ url: string; ua: string | undefined }> = [];
    const f = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ua: (init?.headers as Record<string, string> | undefined)?.["User-Agent"] });
      return fetchFrom([["offset=100", fx("polymarket-markets-page2.json")], ["offset=0", fx("polymarket-markets-page1.json")]])(input, init);
    }) as typeof fetch;
    const out = await POLYMARKET_FEED.list(f, window);
    expect(calls.length).toBe(1); // the fixture page holds 40 rows, under PAGE, so paging stops
    expect(calls[0]!.ua).toMatch(/Mozilla/);
    expect(calls[0]!.url).toContain("end_date_min=2026-09-11T18:00:00Z");
    expect(calls[0]!.url).toContain("volume_num_min=");
    expect(out.length).toBeGreaterThan(0);
    const m = out[0]!;
    expect(m.source).toBe("polymarket");
    expect(m.prob).toBeGreaterThan(0);
    expect(m.prob).toBeLessThan(1);
    expect(m.url).toMatch(/^https:\/\/polymarket\.com\/event\//);
    expect(m.eventKey.length).toBeGreaterThan(0);
    expect(Date.parse(m.closesAt)).not.toBeNaN();
  });
  it("skips rows whose prices do not parse", async () => {
    const page = JSON.parse(fx("polymarket-markets-page1.json"));
    page[0].outcomePrices = "not json";
    const out = await POLYMARKET_FEED.list(fetchFrom([["offset=100", "[]"], ["offset=0", JSON.stringify(page)]]), window);
    expect(out.find((m) => m.marketId === String(page[0].id))).toBeUndefined();
  });
});

describe("POLYMARKET_FEED.read", () => {
  it("resolved yes", async () => {
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", fx("polymarket-market-resolved-yes.json")]]), "1")).toMatchObject({ settled: true, outcome: "yes" });
  });
  it("resolved no", async () => {
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", fx("polymarket-market-resolved-no.json")]]), "1")).toMatchObject({ settled: true, outcome: "no" });
  });
  it("open is not settled", async () => {
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", fx("polymarket-market-open.json")]]), "1")).toMatchObject({ settled: false, outcome: null });
  });
  it("closed but not yet resolved by UMA is not settled", async () => {
    const m = JSON.parse(fx("polymarket-market-resolved-yes.json"));
    m.umaResolutionStatus = "proposed";
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", JSON.stringify(m)]]), "1")).toMatchObject({ settled: false, outcome: null });
  });
  it("resolved with split prices is a void", async () => {
    const m = JSON.parse(fx("polymarket-market-resolved-yes.json"));
    m.outcomePrices = JSON.stringify(["0.5", "0.5"]);
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", JSON.stringify(m)]]), "1")).toMatchObject({ settled: true, outcome: "void" });
  });
});

describe("polymarketCategory", () => {
  it("maps tag slugs", () => {
    expect(polymarketCategory(["sports", "nfl"])).toBe("sports");
    expect(polymarketCategory(["crypto"])).toBe("markets");
    expect(polymarketCategory(["business", "economy"])).toBe("markets");
    expect(polymarketCategory(["pop-culture"])).toBe("culture");
    expect(polymarketCategory(["weather"])).toBe("weather");
    expect(polymarketCategory(["politics"])).toBe("news");
    expect(polymarketCategory([])).toBe("news");
  });
});
