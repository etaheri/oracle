// Tier 3 — the pre-flight resolve, pointed backwards (design 2026-09-04 §3.2).
//
// This is the check that makes the anti-leak guarantee REAL instead of
// self-reported. `resolves_at` is a claim the author makes about its own draft
// and nothing has ever verified it; here the pipeline's own resolver is turned
// on the candidate tonight, against its own named source, and the meaning of
// the answer is inverted:
//
//   yes / no WITH quotes  -> REJECT. The answer already exists. This was never
//                            a prediction; it is a lookup with a countdown.
//   unverifiable          -> PASS. The answer does not exist yet, which is the
//                            entire requirement.
//
// A LIMIT, STATED HERE RATHER THAN DISCOVERED LATER: askResolver restricts the
// search to the source's own hostname, so an `unverifiable` proves THE NAMED
// SOURCE does not show it yet — not that no source does. A question already
// answered on a wire service but not yet on the named source will pass. That
// is the right scope, because resolution will read only that source too, but
// the guarantee is "not answerable from the source we will judge it by", never
// "not knowable anywhere". If leak telemetry ever shows questions arriving
// pre-answered from elsewhere, widening this search is the lever.
import type { PipelineDeps } from "../index";
import type { Rejection } from "../candidate";
import type { Judged } from "./critic";
import { askResolver, settled } from "../resolver";
import { BudgetExhausted } from "../spend";

export type PreflightOutcome =
  | { index: number; passed: true }
  | { index: number; passed: false; rejection: Rejection };

/**
 * One candidate's pre-flight, as a VALUE carrying its own index.
 *
 * The index travels with the result because the Workflow fan-out reassembles
 * positionally after Promise.all, and because a step named `preflight-3`
 * whose result does not know it is 3 is a debugging trap.
 *
 * Throws only BudgetExhausted — a day-level stop, not one candidate's
 * problem — let it propagate and abort the gauntlet the way it already does
 * everywhere else a model call happens. Every other failure becomes an
 * "ambiguous" rejection: already the critic's reason for the identical
 * shape — a model call this gate depends on came back unreadable, so there
 * is no verdict to judge. It is honest in a way "already-resolvable" would
 * not be (nothing was found already-resolvable) and in a way "dead-source"
 * would not be (the candidate's source_url was never fetched here; the
 * failure is the resolver call itself).
 */
export async function preflightOne(deps: PipelineDeps, j: Judged, index: number): Promise<PreflightOutcome> {
  let verdict: Awaited<ReturnType<typeof askResolver>>;
  try {
    verdict = await askResolver(deps, deps.models.preflight, {
      text: j.candidate.text,
      resolutionCriteria: j.candidate.resolution_criteria,
      sourceName: j.candidate.source_name,
      sourceUrl: j.candidate.source_url,
    });
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return {
      index,
      passed: false,
      rejection: {
        text: j.candidate.text,
        reason: "ambiguous",
        detail: `preflight resolver call failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const answer = settled(verdict);
  if (answer === null) return { index, passed: true };
  return {
    index,
    passed: false,
    rejection: {
      text: j.candidate.text,
      reason: "already-resolvable",
      detail: `${j.candidate.source_name} already answers this: ${answer}`,
    },
  };
}

export async function preflight(
  deps: PipelineDeps,
  judged: Judged[],
): Promise<{ passed: Judged[]; rejected: Rejection[] }> {
  // One call per survivor, in parallel: they are independent, and this is the
  // slowest tier in the gauntlet. Isolated per call, like every neighbouring
  // gate (checkSources, runProbe, runResolution): one candidate's transient
  // 429 or 5xx must reject that candidate, not the whole `Promise.all` — and
  // with it the night, silently, with nothing written and no gauntlet
  // narration fired. Surplus is what makes throwing one candidate away
  // affordable.
  const outcomes = await Promise.all(judged.map((j, i) => preflightOne(deps, j, i)));
  return assemblePreflight(judged, outcomes);
}

/**
 * Reassembly, shared by the inline path above and the Workflow fan-out that
 * will replace its Promise.all, so the two cannot disagree about what a set
 * of per-candidate outcomes means. Sorted by index first so the result is
 * deterministic regardless of the order calls settle in — the fan-out's
 * results arrive in completion order, not candidate order, and `passed`
 * feeds selection next.
 */
export function assemblePreflight(
  judged: Judged[],
  outcomes: PreflightOutcome[],
): { passed: Judged[]; rejected: Rejection[] } {
  const passed: Judged[] = [];
  const rejected: Rejection[] = [];
  for (const o of [...outcomes].sort((a, b) => a.index - b.index)) {
    if (o.passed) passed.push(judged[o.index]!);
    else rejected.push(o.rejection);
  }
  return { passed, rejected };
}
