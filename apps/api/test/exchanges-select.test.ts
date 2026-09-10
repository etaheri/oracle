import { describe, it, expect } from "vitest";
import { SELECT, eligibilityWindow, eligible, selectFive } from "../src/pipeline/exchanges/select";
import type { MarketCandidate } from "../src/pipeline/exchanges/types";

const LOCK = new Date("2026-09-11T16:00:00Z"); // noon ET on Sept 11
const h = (n: number) => new Date(LOCK.getTime() + n * 3_600_000).toISOString();

function cand(over: Partial<MarketCandidate> & { marketId: string }): MarketCandidate {
  return {
    source: "kalshi", eventKey: over.marketId, seriesKey: "KXTEST", title: `Will ${over.marketId}?`, rules: "r",
    url: "https://kalshi.com/markets/kxtest", category: "news", prob: 0.5, volume: 10_000, closesAt: h(10),
    ...over,
  };
}

describe("eligibilityWindow", () => {
  it("runs from lock + 2h to lock + 30h", () => {
    const w = eligibilityWindow(LOCK);
    expect(w.from.toISOString()).toBe(h(2));
    expect(w.to.toISOString()).toBe(h(30));
  });
});

describe("eligible", () => {
  it("keeps only markets closing inside the window", () => {
    const out = eligible([cand({ marketId: "early", closesAt: h(1.5) }), cand({ marketId: "in", closesAt: h(2) }), cand({ marketId: "late", closesAt: h(30.1) })], LOCK);
    expect(out.map((c) => c.marketId)).toEqual(["in"]);
  });
  it("keeps only contested prices and real volume", () => {
    const out = eligible([
      cand({ marketId: "cheap", prob: 0.19 }), cand({ marketId: "dear", prob: 0.81 }),
      cand({ marketId: "thin", volume: 4999 }), cand({ marketId: "ok", prob: 0.2, volume: 5000 }),
    ], LOCK);
    expect(out.map((c) => c.marketId)).toEqual(["ok"]);
  });
  it("drops spread and over/under titles", () => {
    const out = eligible([
      cand({ marketId: "s", title: "Spread: Rams (-3.5)" }), cand({ marketId: "ou", title: "49ers vs. Rams: O/U 48.5" }), cand({ marketId: "ml", title: "49ers vs. Rams" }),
    ], LOCK);
    expect(out.map((c) => c.marketId)).toEqual(["ml"]);
  });
  it("keeps one market per event: the highest volume", () => {
    const out = eligible([
      cand({ marketId: "a", eventKey: "E", volume: 8000 }), cand({ marketId: "b", eventKey: "E", volume: 9000 }), cand({ marketId: "c", eventKey: "F" }),
    ], LOCK);
    expect(out.map((c) => c.marketId).sort()).toEqual(["b", "c"]);
  });
});

describe("selectFive", () => {
  it("returns null under five candidates", () => {
    expect(selectFive([cand({ marketId: "1" }), cand({ marketId: "2" })])).toBeNull();
  });
  it("returns null under four distinct categories", () => {
    expect(selectFive([1, 2, 3, 4, 5].map((i) => cand({ marketId: String(i), category: i < 3 ? "sports" : "news" })))).toBeNull();
  });
  it("spreads categories first, fills by volume, and makes the most traded the Big One", () => {
    const cs = [
      cand({ marketId: "nfl", category: "sports", volume: 240_000 }),
      cand({ marketId: "cpi", category: "news", volume: 35_000 }),
      cand({ marketId: "btc", category: "markets", volume: 200_000 }),
      cand({ marketId: "nyc", category: "weather", volume: 8_400 }),
      cand({ marketId: "bb", category: "culture", volume: 41_000 }),
      cand({ marketId: "eth", category: "markets", volume: 11_000 }),
      cand({ marketId: "kbo", category: "sports", volume: 107_000 }),
    ];
    const five = selectFive(cs)!;
    // By volume: nfl, btc, kbo, bb, cpi, eth, nyc. One per category first takes
    // nfl (sports), btc (markets), bb (culture), cpi (news), nyc (weather) — five,
    // so kbo and eth never enter. The Big One is the most traded, nfl; slots
    // 1-4 are the rest in volume order.
    expect(five.map((c) => c.marketId)).toEqual(["btc", "bb", "cpi", "nyc", "nfl"]);
  });
  it("fills from the same category once every category is represented", () => {
    const cs = [
      cand({ marketId: "a", category: "sports", volume: 90 }), cand({ marketId: "b", category: "markets", volume: 80 }),
      cand({ marketId: "c", category: "news", volume: 70 }), cand({ marketId: "d", category: "weather", volume: 60 }),
      cand({ marketId: "e", category: "sports", volume: 50 }),
    ];
    expect(selectFive(cs)!.map((c) => c.marketId)).toEqual(["b", "c", "d", "e", "a"]);
  });
});
