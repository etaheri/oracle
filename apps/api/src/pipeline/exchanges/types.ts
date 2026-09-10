// The exchange boundary (design 2026-09-10 §5.1, §5.6). Two feeds, one shape.
export type Category = "markets" | "sports" | "weather" | "culture" | "news";
export type ExchangeSource = "kalshi" | "polymarket";

export interface MarketCandidate {
  source: ExchangeSource;
  marketId: string;
  eventKey: string;
  seriesKey: string;
  title: string;
  rules: string;
  url: string;
  category: Category;
  prob: number;
  volume: number;
  closesAt: string;
}

export interface SettlementRead {
  settled: boolean;
  outcome: "yes" | "no" | "void" | null;
  raw: unknown;
}

export interface ExchangeFeed {
  source: ExchangeSource;
  list(fetchFn: typeof fetch, window: { from: Date; to: Date }): Promise<MarketCandidate[]>;
  read(fetchFn: typeof fetch, marketId: string): Promise<SettlementRead>;
}

export const BROWSER_HEADERS = { "User-Agent": "Mozilla/5.0 (oracle-pipeline)", Accept: "application/json" };

export async function getJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const res = await fetchFn(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`exchange: ${res.status} from ${url}`);
  return (await res.json()) as T;
}
