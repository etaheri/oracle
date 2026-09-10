// Eligibility and selection (design 2026-09-10 §5.2, §5.3). Pure.
//
// The window's lower bound is the leak rule: a market whose trading closes at
// least two hours after the lock concerns an event that begins after the
// lock. It is what keeps the game the afternoon before a kickoff from
// carrying that kickoff. The upper bound keeps settlement inside the
// following evening.
import type { Category, MarketCandidate } from "./types";

export const SELECT = {
  CLOSE_AFTER_LOCK_MIN_H: 2,
  CLOSE_AFTER_LOCK_MAX_H: 30,
  PROB_MIN: 0.20,
  PROB_MAX: 0.80,
  VOLUME_MIN: 5000,            // ⚙ tunable
  ROUND_SIZE: 5,
  MIN_DISTINCT_CATEGORIES: 4,  // DraftSchema requires four; a thinner night is the bank's
} as const;

const H = 3_600_000;
const EXCLUDED_TITLE = /^spread\b|\bo\/u\b|\bover\/under\b/i;

export function eligibilityWindow(locksAt: Date): { from: Date; to: Date } {
  return {
    from: new Date(locksAt.getTime() + SELECT.CLOSE_AFTER_LOCK_MIN_H * H),
    to: new Date(locksAt.getTime() + SELECT.CLOSE_AFTER_LOCK_MAX_H * H),
  };
}

export function eligible(candidates: MarketCandidate[], locksAt: Date): MarketCandidate[] {
  const { from, to } = eligibilityWindow(locksAt);
  const inRules = candidates.filter((c) => {
    const t = Date.parse(c.closesAt);
    return (
      t >= from.getTime() && t <= to.getTime() &&
      c.prob >= SELECT.PROB_MIN && c.prob <= SELECT.PROB_MAX &&
      c.volume >= SELECT.VOLUME_MIN &&
      !EXCLUDED_TITLE.test(c.title)
    );
  });
  const byEvent = new Map<string, MarketCandidate>();
  for (const c of inRules) {
    const key = `${c.source}:${c.eventKey}`;
    const prev = byEvent.get(key);
    if (!prev || c.volume > prev.volume) byEvent.set(key, c);
  }
  return [...byEvent.values()];
}

/** Greedy spread by volume: one per category first, then fill. Index 4 is the Big One. */
export function selectFive(candidates: MarketCandidate[]): MarketCandidate[] | null {
  if (candidates.length < SELECT.ROUND_SIZE) return null;
  const ranked = [...candidates].sort((a, b) => b.volume - a.volume);
  const chosen: MarketCandidate[] = [];
  const used = new Set<Category>();
  for (const c of ranked) {
    if (chosen.length === SELECT.ROUND_SIZE) break;
    if (used.has(c.category)) continue;
    chosen.push(c); used.add(c.category);
  }
  for (const c of ranked) {
    if (chosen.length === SELECT.ROUND_SIZE) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  if (chosen.length < SELECT.ROUND_SIZE) return null;
  if (new Set(chosen.map((c) => c.category)).size < SELECT.MIN_DISTINCT_CATEGORIES) return null;
  const big = chosen.reduce((m, c) => (c.volume > m.volume ? c : m), chosen[0]!);
  const rest = chosen.filter((c) => c !== big).sort((a, b) => b.volume - a.volume);
  return [...rest, big];
}
