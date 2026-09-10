// Polymarket's gamma API (verified 2026-09-10): 403s without a browser user
// agent, paginates at 100 by offset, and reports settlement as closed +
// umaResolutionStatus "resolved" with final outcomePrices.
import { getJson, type Category, type ExchangeFeed, type MarketCandidate, type SettlementRead } from "./types";

const BASE = "https://gamma-api.polymarket.com";
const PAGE = 100;
const MAX_PAGES = 20;
const VOLUME_FLOOR = 3000; // the API-side pre-filter; select.ts applies the real floor

interface PolyTag { slug?: string; label?: string }
interface PolyEvent { slug?: string; title?: string; tags?: PolyTag[] }
interface PolyMarket {
  id: string | number; question?: string; description?: string; slug?: string;
  outcomes?: string; outcomePrices?: string; closed?: boolean; active?: boolean;
  umaResolutionStatus?: string; endDate?: string; volumeNum?: number; volume?: string; events?: PolyEvent[];
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

function toCandidate(m: PolyMarket): MarketCandidate | null {
  if (!isBinaryYesNo(m)) return null;
  const p = priceYes(m);
  if (p === null || !m.endDate) return null;
  const event = m.events?.[0];
  const eventSlug = event?.slug ?? m.slug ?? String(m.id);
  const tags = (event?.tags ?? []).map((t) => t.slug ?? "").filter(Boolean);
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
      const url = `${BASE}/markets?closed=false&active=true&volume_num_min=${VOLUME_FLOOR}&end_date_min=${iso(window.from)}&end_date_max=${iso(window.to)}&limit=${PAGE}&offset=${page * PAGE}`;
      const body = await getJson<PolyMarket[]>(fetchFn, url);
      if (!Array.isArray(body) || body.length === 0) break;
      for (const m of body) {
        const c = toCandidate(m);
        if (c) out.push(c);
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
