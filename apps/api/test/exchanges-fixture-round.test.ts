// The test that would have caught the /markets list: run BOTH recorded pages
// through the real feeds, pool them, and prove a version 3 round can actually
// be dealt from them. Nothing here stubs a candidate — the only stub is fetch,
// answering with the JSON `record.py` pulled from the live APIs.
//
// It fails if a feed stops producing categories (the Polymarket bug: rows
// listed from /markets carry an event without `tags`, so every candidate
// categorises as "news" and selectFive can never reach four), if a mapping
// drifts, or if a re-record leaves pages too thin to deal. The fix in that
// last case is to re-run record.py, not to lower the bar here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KALSHI_FEED } from "../src/pipeline/exchanges/kalshi";
import { POLYMARKET_FEED } from "../src/pipeline/exchanges/polymarket";
import { eligible, eligibilityWindow, selectFive, SELECT } from "../src/pipeline/exchanges/select";
import type { MarketCandidate } from "../src/pipeline/exchanges/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(__dirname, "fixtures/exchanges", name), "utf8");

// Ordered longest-needle-first: the Kalshi page-2 route must win over the
// bare "/markets?" that also matches it.
const ROUTES: Array<[string, string]> = [
  ["cursor=PAGE2", fx("kalshi-markets-page2.json")],
  ["/markets?", fx("kalshi-markets-page1.json")],
  ["offset=100", fx("polymarket-markets-page2.json")],
  ["/events?", fx("polymarket-markets-page1.json")],
];

const fetchStub = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const hit = ROUTES.find(([needle]) => url.includes(needle));
  if (!hit) throw new Error(`unexpected fetch: ${url}`);
  return new Response(hit[1], { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

// The feeds only put the window into their query strings; the stub answers
// whatever it is asked. So list with any window, then place the lock from
// what came back.
const LIST_WINDOW = { from: new Date("2026-09-11T18:00:00Z"), to: new Date("2026-09-12T22:00:00Z") };

async function pool(): Promise<MarketCandidate[]> {
  const [k, p] = await Promise.all([
    KALSHI_FEED.list(fetchStub, LIST_WINDOW),
    POLYMARKET_FEED.list(fetchStub, LIST_WINDOW),
  ]);
  return [...k, ...p];
}

// locksAt sits three hours before the earliest recorded close. Two hours and a
// second is enough to clear the lower bound for that one market and nothing
// else; three hours slides the whole thirty-hour window forward over the body
// of the recording.
function lockFor(candidates: MarketCandidate[]): Date {
  const earliest = Math.min(...candidates.map((c) => Date.parse(c.closesAt)));
  return new Date(earliest - 3 * 3_600_000);
}

describe("a round deals from the recorded fixtures", () => {
  it("both feeds produce candidates", async () => {
    const [k, p] = await Promise.all([
      KALSHI_FEED.list(fetchStub, LIST_WINDOW),
      POLYMARKET_FEED.list(fetchStub, LIST_WINDOW),
    ]);
    expect(k.length).toBeGreaterThan(0);
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((c) => c.url.startsWith("https://polymarket.com/event/"))).toBe(true);
  });

  it("the Polymarket page carries more than one category", async () => {
    // The regression itself: /markets rows lose the event's tags and every
    // candidate lands on the "news" fallback.
    const p = await POLYMARKET_FEED.list(fetchStub, LIST_WINDOW);
    expect(new Set(p.map((c) => c.category)).size).toBeGreaterThan(1);
  });

  it("eligibility admits at least five of the pooled fixtures", async () => {
    const candidates = await pool();
    const locksAt = lockFor(candidates);
    const { from, to } = eligibilityWindow(locksAt);
    expect(to.getTime()).toBeGreaterThan(from.getTime());
    expect(eligible(candidates, locksAt).length).toBeGreaterThanOrEqual(SELECT.ROUND_SIZE);
  });

  it("selectFive returns five markets across at least four categories", async () => {
    const candidates = await pool();
    const five = selectFive(eligible(candidates, lockFor(candidates)));
    expect(five).not.toBeNull();
    expect(five!.length).toBe(SELECT.ROUND_SIZE);
    expect(new Set(five!.map((c) => c.category)).size).toBeGreaterThanOrEqual(SELECT.MIN_DISTINCT_CATEGORIES);
    // Index 4 is the Big One: the heaviest of the five.
    expect(five![4]!.volume).toBe(Math.max(...five!.map((c) => c.volume)));
  });
});
