// Market signal feeds (phase 1 of market-informed authoring, docs/superpowers/
// 2026-08-27-plan-4-candidates.md §0.5): real prediction markets closing soon,
// fed to the authoring prompt as contested-ness verified by money. Markets are
// a SELECTION signal only — resolution always stays on primary named sources.
// Each feed is a pluggable MarketFeed so later operators (Hermes Agent) can add
// sources without touching the authoring flow. Kalshi is deliberately absent
// from phase 1: its public endpoints null all price data without an RSA-signed
// key, so it joins as a feed once credentials exist.

export interface MarketSignal {
  question: string;
  prob: number; // probability of YES, 0..1
  closesAt: string; // ISO
  source: "manifold" | "polymarket";
  url: string;
  volume: number;
}

export interface MarketFeed {
  name: MarketSignal["source"];
  fetch(fetchFn: typeof fetch, now: Date, horizonMs: number): Promise<MarketSignal[]>;
}

const HORIZON_MS = 36 * 3_600_000;
const CONTESTED_MIN = 0.2;
const CONTESTED_MAX = 0.8;
const MAX_SIGNALS = 15;
// Real money carries more signal than play money at equal volume.
const TRUST: Record<MarketSignal["source"], number> = { polymarket: 1, manifold: 0.6 };

export const MANIFOLD_FEED: MarketFeed = {
  name: "manifold",
  async fetch(fetchFn, now, horizonMs) {
    const res = await fetchFn(
      "https://api.manifold.markets/v0/search-markets?filter=open&contractType=BINARY&sort=close-date&limit=100&term=",
    );
    if (!res.ok) throw new Error(`manifold: ${res.status}`);
    const rows = (await res.json()) as Array<{
      question?: string; probability?: number; closeTime?: number; volume?: number;
      uniqueBettorCount?: number; outcomeType?: string; url?: string;
    }>;
    return rows
      .filter((m) =>
        m.outcomeType === "BINARY" &&
        typeof m.probability === "number" &&
        typeof m.closeTime === "number" &&
        m.closeTime > now.getTime() &&
        m.closeTime <= now.getTime() + horizonMs &&
        (m.uniqueBettorCount ?? 0) >= 5,
      )
      .map((m) => ({
        question: m.question ?? "",
        prob: m.probability!,
        closesAt: new Date(m.closeTime!).toISOString(),
        source: "manifold" as const,
        url: m.url ?? "https://manifold.markets",
        volume: m.volume ?? 0,
      }));
  },
};

export const POLYMARKET_FEED: MarketFeed = {
  name: "polymarket",
  async fetch(fetchFn, now, horizonMs) {
    const min = now.toISOString();
    const max = new Date(now.getTime() + horizonMs).toISOString();
    const res = await fetchFn(
      `https://gamma-api.polymarket.com/markets?closed=false&active=true&end_date_min=${min}&end_date_max=${max}&limit=100`,
    );
    if (!res.ok) throw new Error(`polymarket: ${res.status}`);
    const rows = (await res.json()) as Array<{
      question?: string; outcomePrices?: string; endDate?: string; volume?: string; slug?: string;
    }>;
    const out: MarketSignal[] = [];
    for (const m of rows) {
      let prob: number | null = null;
      try {
        const prices = JSON.parse(m.outcomePrices ?? "") as string[];
        const p = Number(prices[0]);
        if (Number.isFinite(p)) prob = p;
      } catch { /* unparseable prices — skip the row */ }
      const volume = Number(m.volume ?? 0);
      if (prob === null || !m.endDate || volume < 500) continue;
      out.push({
        question: m.question ?? "",
        prob,
        closesAt: m.endDate,
        source: "polymarket",
        url: `https://polymarket.com/event/${m.slug ?? ""}`,
        volume,
      });
    }
    return out;
  },
};

export const DEFAULT_FEEDS: MarketFeed[] = [MANIFOLD_FEED, POLYMARKET_FEED];

// Contested filter + trust × contestedness × volume ranking, capped. Pure.
export function rankSignals(signals: MarketSignal[]): MarketSignal[] {
  const score = (s: MarketSignal) =>
    TRUST[s.source] * (1 - 2 * Math.abs(s.prob - 0.5)) * Math.log10(s.volume + 10);
  return signals
    .filter((s) => s.prob >= CONTESTED_MIN && s.prob <= CONTESTED_MAX)
    .sort((a, b) => score(b) - score(a))
    .slice(0, MAX_SIGNALS);
}

// Per-feed isolation: one feed failing never blocks the others, and no feed
// failure ever blocks authoring — callers proceed market-blind on [].
export async function fetchMarketSignals(
  fetchFn: typeof fetch,
  now: Date,
  feeds: MarketFeed[] = DEFAULT_FEEDS,
): Promise<{ signals: MarketSignal[]; failures: string[] }> {
  const signals: MarketSignal[] = [];
  const failures: string[] = [];
  for (const feed of feeds) {
    try {
      signals.push(...(await feed.fetch(fetchFn, now, HORIZON_MS)));
    } catch (e) {
      console.error(`[feeds] ${feed.name} failed:`, e instanceof Error ? e.message : e);
      failures.push(feed.name);
    }
  }
  return { signals: rankSignals(signals), failures };
}
