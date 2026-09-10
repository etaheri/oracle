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

// The list fixture is a page of EVENTS, each carrying its tags and its binary
// markets nested underneath. `record.py` rewrites it from the live API.
const page1 = () => JSON.parse(fx("polymarket-markets-page1.json")) as Array<{
  slug: string; tags: Array<{ slug: string }>; markets: Array<Record<string, unknown>>;
}>;
const routed = (body: unknown) => fetchFrom([["offset=100", "[]"], ["offset=0", JSON.stringify(body)]]);

describe("POLYMARKET_FEED.list", () => {
  const window = { from: new Date("2026-09-11T18:00:00Z"), to: new Date("2026-09-12T22:00:00Z") };
  it("pages /events, stops at a short page, sends a browser user agent, maps fields", async () => {
    const calls: Array<{ url: string; ua: string | undefined }> = [];
    const f = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ua: (init?.headers as Record<string, string> | undefined)?.["User-Agent"] });
      return fetchFrom([["offset=100", fx("polymarket-markets-page2.json")], ["offset=0", fx("polymarket-markets-page1.json")]])(input, init);
    }) as typeof fetch;
    const out = await POLYMARKET_FEED.list(f, window);
    expect(calls.length).toBe(1); // the fixture page holds 40 events, under PAGE, so paging stops
    expect(calls[0]!.url).toContain("/events?");
    expect(calls[0]!.ua).toMatch(/Mozilla/);
    expect(calls[0]!.url).toContain("end_date_min=2026-09-11T18:00:00Z");
    expect(calls[0]!.url).toContain("volume_min=");
    expect(out.length).toBeGreaterThan(0);
    const m = out[0]!;
    expect(m.source).toBe("polymarket");
    expect(m.prob).toBeGreaterThan(0);
    expect(m.prob).toBeLessThan(1);
    expect(m.url).toMatch(/^https:\/\/polymarket\.com\/event\//);
    expect(m.eventKey.length).toBeGreaterThan(0);
    expect(Date.parse(m.closesAt)).not.toBeNaN();
  });

  // The bug this shape exists to prevent: listed from /markets, an event row
  // arrives without its tags, every candidate falls through to "news", and
  // selectFive can never reach four distinct categories.
  it("takes the category, event key and url from the enclosing event", async () => {
    const page = page1();
    const ev = page.find((e) => (e.tags ?? []).length > 0 && (e.markets ?? []).length > 0)!;
    const out = await POLYMARKET_FEED.list(routed(page), window);
    const mine = out.filter((c) => c.eventKey === ev.slug);
    expect(mine.length).toBeGreaterThan(0);
    const tags = ev.tags.map((t) => t.slug);
    expect(mine[0]!.category).toBe(polymarketCategory(tags));
    expect(mine[0]!.seriesKey).toBe(tags[0]);
    expect(mine[0]!.url).toBe(`https://polymarket.com/event/${ev.slug}`);
    expect(new Set(out.map((c) => c.category)).size).toBeGreaterThan(1);
  });

  it("skips rows whose prices do not parse", async () => {
    const page = page1();
    const target = page[0]!.markets[0]!;
    target.outcomePrices = "not json";
    const out = await POLYMARKET_FEED.list(routed(page), window);
    expect(out.find((m) => m.marketId === String(target.id))).toBeUndefined();
    expect(out.length).toBeGreaterThan(0);
  });

  it("drops markets whose outcomes are not Yes/No", async () => {
    const page = page1();
    const all = page.flatMap((e) => e.markets ?? []);
    let nonBinary = all.find((m) => {
      try {
        const o = JSON.parse(String(m.outcomes ?? ""));
        return !(Array.isArray(o) && o.length === 2 && String(o[0]).toLowerCase() === "yes" && String(o[1]).toLowerCase() === "no");
      } catch {
        return true;
      }
    });
    if (!nonBinary) {
      nonBinary = all[0]!;
      nonBinary.outcomes = JSON.stringify(["49ers", "Rams"]);
    }
    const out = await POLYMARKET_FEED.list(routed(page), window);
    expect(out.find((m) => m.marketId === String(nonBinary!.id))).toBeUndefined();
    expect(out.length).toBeGreaterThan(0);
  });

  // An open event can hold a leg that has already settled.
  it("drops a closed market nested inside an open event", async () => {
    const page = page1();
    const target = page.flatMap((e) => e.markets ?? []).find((m) => m.closed !== true)!;
    target.closed = true;
    const out = await POLYMARKET_FEED.list(routed(page), window);
    expect(out.find((m) => m.marketId === String(target.id))).toBeUndefined();
  });

  it("keeps paging while a page is full", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      slug: `e${i}`, tags: [{ slug: "crypto" }],
      markets: [{ id: `m${i}`, question: "q", outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', endDate: "2026-09-12T00:00:00Z", volumeNum: 9000 }],
    }));
    const calls: string[] = [];
    const f = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return fetchFrom([["offset=100", "[]"], ["offset=0", JSON.stringify(full)]])(input);
    }) as typeof fetch;
    const out = await POLYMARKET_FEED.list(f, window);
    expect(calls.length).toBe(2);
    expect(out.length).toBe(100);
    expect(out[0]!.category).toBe("markets");
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
