// Kalshi public market data (verified 2026-09-10): no key needed for reads,
// prices live in the *_dollars fields, statuses run initialized → active →
// determined → finalized, and `result` is set from determined onward.
import { getJson, type Category, type ExchangeFeed, type MarketCandidate, type SettlementRead } from "./types";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const PAGE = 1000;
const MAX_PAGES = 15;

interface KalshiMarket {
  ticker: string; event_ticker: string; status: string; result?: string | null;
  close_time: string; title: string; yes_sub_title?: string | null; rules_primary?: string | null;
  yes_bid_dollars?: string | null; yes_ask_dollars?: string | null; volume_fp?: string | null;
  market_type?: string | null; mve_collection_ticker?: string | null;
}

// Event categories as Kalshi names them → the app's five.
const EVENT_CATEGORY: Record<string, Category> = {
  "Sports": "sports",
  "Climate and Weather": "weather",
  "Entertainment": "culture",
  "Financials": "markets",
  "Companies": "markets",
  "Economics": "news",
  "Elections": "news",
  "Politics": "news",
  "World": "news",
  "Social": "news",
  "Health": "news",
  "Science and Technology": "news",
};

// Series-prefix table for when no event record is at hand. Order matters:
// the first matching prefix wins. Unknown series are news, never rejected.
const SERIES_PREFIX: Array<[RegExp, Category]> = [
  [/^KX(HIGH|LOW|RAIN|SNOW|TEMP)/, "weather"],
  [/^KX(BTC|ETH|SOL|DOGE|XRP|NASDAQ|SP500|INX|DJI|GOLD|SILVER|WTI|BRENT|OIL|TSLA|NVDA|AAPL)/, "markets"],
  [/^KX(BIGBROTHER|RT|OSCAR|EMMY|GRAMMY|BILLBOARD|SPOTIFY|BOXOFFICE|SURVIVOR|BACHELOR)/, "culture"],
  [/(GAME|SPREAD|TOTAL|MATCH|MAP|WINNER|SERIES)$/, "sports"],
  [/^KX(NFL|NBA|MLB|NHL|UFC|KBO|NPB|CS2|DOTA2|LOL|WFIBA|FIBA|EPL|UCL|MLS|PGA|ATP|WTA|F1|NASCAR)/, "sports"],
];

export function kalshiCategory(seriesTicker: string, eventCategory?: string | null): Category {
  if (eventCategory && EVENT_CATEGORY[eventCategory]) return EVENT_CATEGORY[eventCategory]!;
  for (const [re, cat] of SERIES_PREFIX) if (re.test(seriesTicker)) return cat;
  return "news";
}

function seriesOf(eventTicker: string): string {
  return eventTicker.split("-")[0]!;
}

function toCandidate(m: KalshiMarket): MarketCandidate | null {
  if (m.mve_collection_ticker || m.ticker.startsWith("KXMVE")) return null;      // multi-leg exotics
  if (m.market_type && m.market_type !== "binary") return null;
  const bid = Number(m.yes_bid_dollars ?? 0);
  const ask = Number(m.yes_ask_dollars ?? 0);
  if (!(bid > 0) || !(ask > 0)) return null;                                     // no two-sided price
  const series = seriesOf(m.event_ticker);
  return {
    source: "kalshi",
    marketId: m.ticker,
    eventKey: m.event_ticker,
    seriesKey: series,
    title: m.yes_sub_title ? `${m.title} — ${m.yes_sub_title}` : m.title,
    rules: m.rules_primary ?? "",
    url: `https://kalshi.com/markets/${series.toLowerCase()}`,
    category: kalshiCategory(series),
    prob: (bid + ask) / 2,
    volume: Number(m.volume_fp ?? 0),
    closesAt: new Date(m.close_time).toISOString(),
  };
}

export const KALSHI_FEED: ExchangeFeed = {
  source: "kalshi",
  async list(fetchFn, window) {
    const min = Math.floor(window.from.getTime() / 1000);
    const max = Math.floor(window.to.getTime() / 1000);
    const seen = new Set<string>();
    const out: MarketCandidate[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${BASE}/markets?status=open&limit=${PAGE}&min_close_ts=${min}&max_close_ts=${max}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const body = await getJson<{ markets: KalshiMarket[]; cursor?: string }>(fetchFn, url);
      for (const m of body.markets ?? []) {
        if (seen.has(m.ticker)) continue;
        seen.add(m.ticker);
        const c = toCandidate(m);
        if (c) out.push(c);
      }
      cursor = body.cursor ?? "";
      if (!cursor) break;
    }
    return out;
  },
  async read(fetchFn, marketId) {
    const body = await getJson<{ market: KalshiMarket }>(fetchFn, `${BASE}/markets/${encodeURIComponent(marketId)}`);
    const m = body.market;
    const decided = m.status === "determined" || m.status === "finalized";
    if (!decided) return { settled: false, outcome: null, raw: m };
    const outcome = m.result === "yes" ? "yes" : m.result === "no" ? "no" : "void";
    return { settled: true, outcome, raw: m };
  },
};

/** One event record, for the five selected markets only (category + settlement sources). */
export async function kalshiEvent(fetchFn: typeof fetch, eventTicker: string): Promise<{ category: string | null; settlementSources: Array<{ name?: string; url?: string }> }> {
  const body = await getJson<{ event: { category?: string | null; settlement_sources?: Array<{ name?: string; url?: string }> } }>(
    fetchFn, `${BASE}/events/${encodeURIComponent(eventTicker)}`,
  );
  return { category: body.event.category ?? null, settlementSources: body.event.settlement_sources ?? [] };
}
