// The market round (design 2026-09-10 §5): fetch → eligibility → select →
// voice → taste → commit → narrate. One run a night. No model resolver, no
// probe, no retry loop: a night that cannot deal five markets is the bank's.
import { eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { addDays, noonET } from "./clock";
import { DraftSchema, upsertDraft, type Draft } from "./draft";
import { KALSHI_FEED, kalshiEvent, kalshiCategory } from "./exchanges/kalshi";
import { POLYMARKET_FEED } from "./exchanges/polymarket";
import { eligible, eligibilityWindow, selectFive, SELECT } from "./exchanges/select";
import type { ExchangeFeed, MarketCandidate } from "./exchanges/types";
import { voiceQuestions } from "./voice";
import { tasteTexts } from "./gauntlet/taste";

export const DEFAULT_EXCHANGES: ExchangeFeed[] = [KALSHI_FEED, POLYMARKET_FEED];

export interface MarketRoundResult { published: boolean; fetched: number; eligible: number; reason: string | null }

const SOURCE_NAME = { kalshi: "Kalshi", polymarket: "Polymarket" } as const;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export async function fetchCandidates(deps: PipelineDeps, date: string): Promise<MarketCandidate[]> {
  const locksAt = noonET(addDays(date, 1));
  const fetchFn = deps.marketFetch ?? fetch;
  const feeds = deps.exchangeFeeds ?? DEFAULT_EXCHANGES;
  const window = eligibilityWindow(locksAt);
  const pooled: MarketCandidate[] = [];
  for (const feed of feeds) pooled.push(...(await feed.list(fetchFn, window)));
  return eligible(pooled, locksAt).sort((a, b) => b.volume - a.volume);
}

async function enrich(deps: PipelineDeps, c: MarketCandidate): Promise<MarketCandidate> {
  // Five event reads at most, for the category the series table could not
  // know and the exchange's own settlement source. Best-effort: a failed read
  // keeps the candidate as it was.
  if (c.source !== "kalshi") return c;
  try {
    const ev = await kalshiEvent(deps.marketFetch ?? fetch, c.eventKey);
    const url = ev.settlementSources.find((s) => s.url)?.url;
    return { ...c, category: kalshiCategory(c.seriesKey, ev.category), url: url ?? c.url };
  } catch {
    return c;
  }
}

function toDraft(five: MarketCandidate[], voiced: Array<{ slot: number; text: string; context: string }>, now: Date): Draft {
  return DraftSchema.parse({
    questions: five.map((c, i) => {
      const slot = i + 1;
      const v = voiced.find((x) => x.slot === slot)!;
      return {
        slot,
        category: c.category,
        text: v.text,
        resolution_criteria: `${c.title}\n\n${c.rules || "Resolves per the exchange's rules for this market."}`,
        source_name: SOURCE_NAME[c.source],
        source_url: c.url,
        // Vestigial at version 3: the band is the draft schema's, the number is the market's.
        author_probability: clamp(c.prob, 0.3, 0.7),
        is_big_one: slot === SELECT.ROUND_SIZE,
        market_prob: c.prob,
        resolves_at: c.closesAt,
        ...(v.context.trim() ? { context: { text: v.context.trim(), asOf: now.toISOString(), sourceUrl: c.url } } : {}),
        market: { source: c.source, id: c.marketId, event_key: c.eventKey, closes_at: c.closesAt },
      };
    }),
  });
}

export async function buildMarketDraft(deps: PipelineDeps, date: string, pool: MarketCandidate[]): Promise<{ draft: Draft | null; reason: string | null }> {
  let remaining = pool;
  let refusedSoFar = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const five = selectFive(remaining);
    if (!five) {
      return {
        draft: null,
        reason: refusedSoFar > 0
          ? `the taste gate refused ${refusedSoFar} market${refusedSoFar === 1 ? "" : "s"} and ${remaining.length} remained`
          : `${remaining.length} eligible market${remaining.length === 1 ? "" : "s"} across too few categories`,
      };
    }
    const enriched: MarketCandidate[] = [];
    for (const c of five) enriched.push(await enrich(deps, c));
    const voiced = await voiceQuestions(deps, date, enriched.map((c, i) => ({ slot: i + 1, title: c.title, rules: c.rules, category: c.category, isBigOne: i === 4 })));
    const taste = await tasteTexts(deps, voiced.map((v) => v.text));
    if (taste.detail !== null) return { draft: null, reason: taste.detail };
    const refused = enriched.filter((_, i) => !taste.allowed[i]);
    if (refused.length === 0) return { draft: toDraft(enriched, voiced, deps.now()), reason: null };
    const refusedIds = new Set(refused.map((c) => c.marketId));
    refusedSoFar += refused.length;
    remaining = remaining.filter((c) => !refusedIds.has(c.marketId));
  }
  return { draft: null, reason: "the taste gate refused a market on both passes" };
}

export async function commitMarketDraft(deps: PipelineDeps, date: string, draft: Draft): Promise<void> {
  await upsertDraft(deps.db, date, draft, 3);
}

export async function narrateMarketRound(deps: PipelineDeps, date: string, r: MarketRoundResult): Promise<void> {
  if (r.published) {
    await deps.telegram.send(`${date}: ${r.fetched} markets fetched, ${r.eligible} eligible, 5 published`);
  } else {
    await deps.telegram.send(`⚠ ${date}: no market round — ${r.reason ?? "unknown"} (${r.fetched} fetched, ${r.eligible} eligible); the bank covers noon`);
  }
}

export async function runMarketRound(deps: PipelineDeps, date: string): Promise<MarketRoundResult> {
  const existing = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (existing && (existing.status !== "scheduled" || existing.oracleCommittedAt !== null)) {
    const r = { published: false, fetched: 0, eligible: 0, reason: "round not editable" };
    return r;
  }
  const candidates = await fetchCandidates(deps, date);
  const fetched = candidates.length;
  let result: MarketRoundResult;
  if (candidates.length < SELECT.ROUND_SIZE) {
    result = { published: false, fetched, eligible: candidates.length, reason: `${candidates.length} eligible market${candidates.length === 1 ? "" : "s"}, five needed` };
  } else {
    const { draft, reason } = await buildMarketDraft(deps, date, candidates);
    if (draft) {
      await commitMarketDraft(deps, date, draft);
      result = { published: true, fetched, eligible: candidates.length, reason: null };
    } else {
      result = { published: false, fetched, eligible: candidates.length, reason };
    }
  }
  await narrateMarketRound(deps, date, result);
  return result;
}
