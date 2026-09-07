// Selection (design 2026-09-04 §4): five questions out of whatever survived
// the gauntlet.
//
// Pure — no deps, no I/O — so the composition rules are testable without a
// database, and so that "what shape is a round" stays one readable function.
//
// RELAXATION APPLIES TO COMPOSITION ONLY. Four distinct categories is an
// interest heuristic; five valid questions matter more than the spread. There
// is no path in this file by which a candidate that failed an integrity gate
// is published because nothing better was available — this function never sees
// a rejected candidate at all.
import type { Draft } from "../draft";
import type { Judged } from "./critic";

export const MIN_DISTINCT_CATEGORIES = 4;
export const RELAXED_DISTINCT_CATEGORIES = 3;
const ROUND_SIZE = 5;

export interface Selection { draft: Draft; relaxed: boolean }

// Most contested first. The Big One is the most contested survivor, which is
// the definition 2026-08-27 already gives it.
const byContest = (a: Judged, b: Judged) =>
  Math.abs(a.criticProbability - 0.5) - Math.abs(b.criticProbability - 0.5);

// Greedy spread: walk the contest-ranked list taking the most contested
// candidate of each category first, then fill the remaining slots from what is
// left, still in contest order. This is what makes "prefer spread over contest
// when both are possible" true without a search.
function pickFive(ranked: Judged[]): Judged[] | null {
  if (ranked.length < ROUND_SIZE) return null;
  const chosen: Judged[] = [];
  const usedCategories = new Set<string>();
  for (const j of ranked) {
    if (chosen.length === ROUND_SIZE) break;
    if (usedCategories.has(j.candidate.category)) continue;
    chosen.push(j);
    usedCategories.add(j.candidate.category);
  }
  for (const j of ranked) {
    if (chosen.length === ROUND_SIZE) break;
    if (chosen.includes(j)) continue;
    chosen.push(j);
  }
  return chosen.length === ROUND_SIZE ? chosen : null;
}

function toDraft(chosen: Judged[]): Draft {
  // Slot 5 is the most contested of the five; slots 1-4 take the rest in
  // contest order, which puts the day's sharpest questions earliest.
  const ranked = [...chosen].sort(byContest);
  const nominated = ranked.filter(j => j.editorial?.bigOne);
  const big = nominated.length ? [...nominated].sort((a, b) => b.editorial!.interest - a.editorial!.interest || b.editorial!.reasonability - a.editorial!.reasonability)[0]! : ranked[0]!;
  const rest = ranked.filter(j => j !== big);
  if (rest.some(j => j.editorial)) rest.sort((a, b) => Number(!!b.editorial?.opener) - Number(!!a.editorial?.opener) || (b.editorial?.understandability ?? 0) - (a.editorial?.understandability ?? 0) || (b.editorial?.interest ?? 0) - (a.editorial?.interest ?? 0));
  const question = (j: Judged, slot: number) => ({
    slot,
    category: j.candidate.category,
    text: j.candidate.text,
    resolution_criteria: j.candidate.resolution_criteria,
    source_name: j.candidate.source_name,
    source_url: j.candidate.source_url,
    author_probability: j.candidate.author_probability,
    is_big_one: slot === ROUND_SIZE,
    market_prob: j.candidate.market_prob,
    resolves_at: j.candidate.resolves_at,
    topic_key: j.candidate.topic_key,
    ...(j.candidate.context ? { context: j.candidate.context } : {}),
  });
  return { questions: [...rest.map((j, i) => question(j, i + 1)), question(big, ROUND_SIZE)] };
}

export function selectRound(judged: Judged[]): Selection | null {
  const ranked = [...judged].filter(j => !j.editorial || (j.editorial.understandability > 0 && j.editorial.reasonability > 0 && j.editorial.interest > 0)).sort((a, b) => (b.editorial?.interest ?? 0) - (a.editorial?.interest ?? 0) || byContest(a, b));
  const chosen = pickFive(ranked);
  if (!chosen) return null;

  const distinct = new Set(chosen.map((j) => j.candidate.category)).size;
  if (distinct >= MIN_DISTINCT_CATEGORIES) return { draft: toDraft(chosen), relaxed: false };
  if (distinct >= RELAXED_DISTINCT_CATEGORIES) return { draft: toDraft(chosen), relaxed: true };
  return null;
}
