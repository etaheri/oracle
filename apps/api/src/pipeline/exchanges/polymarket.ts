// Polymarket's gamma API (verified 2026-09-10): 403s without a browser user
// agent, paginates at 100 by offset, and reports settlement as closed +
// umaResolutionStatus "resolved" with final outcomePrices.
//
// THE LIST READS /events, NOT /markets. A market row from `GET /markets`
// carries an `events[0]` WITHOUT its `tags`, so every candidate sourced that
// way categorises as "news" and selectFive can never reach the four distinct
// categories DraftSchema demands. `GET /events` carries `tags[]` on the event
// and the event's binary markets nested underneath, which is the only shape
// that gives a candidate its category. Settlement still reads a single
// market: `GET /markets/{id}` is the only route with umaResolutionStatus.
import { getJson, type Category, type ExchangeFeed, type MarketCandidate, type SettlementRead } from "./types";

const BASE = "https://gamma-api.polymarket.com";
const PAGE = 100;
const MAX_PAGES = 20;
// The API-side pre-filter, applied to the EVENT's volume; select.ts applies
// the real per-market floor. An event's volume is the sum over its markets,
// so it is never below any one market's — filtering events at the same
// number therefore cannot drop a market that would have passed select.
const VOLUME_FLOOR = 5000;

interface PolyTag { slug?: string; label?: string }
interface PolyMarket {
  id: string | number; question?: string; description?: string; slug?: string;
  outcomes?: string; outcomePrices?: string; closed?: boolean; active?: boolean;
  umaResolutionStatus?: string; endDate?: string; volumeNum?: number; volume?: string;
}
interface PolyEvent {
  id?: string | number; slug?: string; title?: string; tags?: PolyTag[];
  endDate?: string; volume?: number; markets?: PolyMarket[];
}

const TAG_CATEGORY: Array<[RegExp, Category]> = [
  [/^(sports|nfl|nba|mlb|nhl|soccer|tennis|ufc|mma|golf|f1|esports)$/, "sports"],
  [/^(crypto|bitcoin|ethereum|business|economy|stocks|finance|fed|earnings)$/, "markets"],
  [/^(weather|climate)$/, "weather"],
  [/^(pop-culture|entertainment|music|movies|tv|awards|celebrities)$/, "culture"],
];

export function polymarketCategory(tagSlugs: string[]): Category {
  for (const slug of tagSlugs) for (const [re, cat] of TAG_CATEGORY) if (re.test(slug)) return cat;
  return "news";
}

function priceYes(m: PolyMarket): number | null {
  try {
    const prices = JSON.parse(m.outcomePrices ?? "[]") as string[];
    const p = Number(prices[0]);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

function isBinaryYesNo(m: PolyMarket): boolean {
  try {
    const outcomes = JSON.parse(m.outcomes ?? "") as unknown;
    if (!Array.isArray(outcomes) || outcomes.length !== 2) return false;
    const [a, b] = outcomes as [unknown, unknown];
    return typeof a === "string" && typeof b === "string" && a.toLowerCase() === "yes" && b.toLowerCase() === "no";
  } catch {
    return false;
  }
}

function toCandidate(m: PolyMarket, event: PolyEvent): MarketCandidate | null {
  if (m.closed === true) return null;                 // an open event can hold a settled leg
  if (!isBinaryYesNo(m)) return null;
  const p = priceYes(m);
  if (p === null || !m.endDate) return null;
  const eventSlug = event.slug ?? m.slug ?? String(m.id);
  const tags = (event.tags ?? []).map((t) => t.slug ?? "").filter(Boolean);
  return {
    source: "polymarket",
    marketId: String(m.id),
    eventKey: eventSlug,
    seriesKey: tags[0] ?? eventSlug,
    title: m.question ?? "",
    rules: m.description ?? "",
    url: `https://polymarket.com/event/${eventSlug}`,
    category: polymarketCategory(tags),
    prob: p,
    volume: Number(m.volumeNum ?? m.volume ?? 0),
    closesAt: new Date(m.endDate).toISOString(),
  };
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export const POLYMARKET_FEED: ExchangeFeed = {
  source: "polymarket",
  async list(fetchFn, window) {
    const out: MarketCandidate[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${BASE}/events?closed=false&active=true&volume_min=${VOLUME_FLOOR}&end_date_min=${iso(window.from)}&end_date_max=${iso(window.to)}&limit=${PAGE}&offset=${page * PAGE}`;
      const body = await getJson<PolyEvent[]>(fetchFn, url);
      if (!Array.isArray(body) || body.length === 0) break;
      for (const event of body) {
        for (const m of event.markets ?? []) {
          const c = toCandidate(m, event);
          if (c) out.push(c);
        }
      }
      if (body.length < PAGE) break;
    }
    return out;
  },
  async read(fetchFn, marketId) {
    const m = await getJson<PolyMarket>(fetchFn, `${BASE}/markets/${encodeURIComponent(marketId)}`);
    const resolved = m.closed === true && m.umaResolutionStatus === "resolved";
    if (!resolved) return { settled: false, outcome: null, raw: m };
    const p = priceYes(m);
    const outcome = p === 1 ? "yes" : p === 0 ? "no" : "void";
    return { settled: true, outcome, raw: m };
  },
};
