// Tier 1 — does the promised source actually exist (design 2026-09-04 §3.2).
//
// z.string().url() checks a string's SHAPE. A hallucinated but well-formed URL
// passes it today and fails 24 hours later at resolution, by which point the
// question has already run in front of everyone and voids. One GET per
// candidate, no model, catches it the night before for nothing.
//
// feeds.ts already performs keyless HTTP from this Worker, so the pattern
// exists; the fetch is injected so no test ever touches the network.
import type { Candidate, Rejection, Screened } from "../candidate";

export const SOURCE_TIMEOUT_MS = 5000;

export async function checkSources(fetchFn: typeof fetch, candidates: Candidate[]): Promise<Screened> {
  // In parallel and settled, not raced: one unreachable source must never
  // abort the batch, and a rejection here is a normal outcome rather than an
  // error condition.
  const results = await Promise.all(
    candidates.map(async (c): Promise<Rejection | null> => {
      try {
        const res = await fetchFn(c.source_url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        if (!res.ok) return { text: c.text, reason: "dead-source", detail: `${c.source_url} answered ${res.status}` };
        return null;
      } catch (err) {
        // A timeout is a rejection, not a retry: a source this slow the night
        // before is not a source resolution can lean on tomorrow.
        return { text: c.text, reason: "dead-source", detail: `${c.source_url}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }),
  );

  const passed: Candidate[] = [];
  const rejected: Rejection[] = [];
  results.forEach((r, i) => (r ? rejected.push(r) : passed.push(candidates[i]!)));
  return { passed, rejected };
}
