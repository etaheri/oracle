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

type Outcome = { ok: true; verdict: Awaited<ReturnType<typeof askResolver>> } | { ok: false; error: unknown };

export async function preflight(
  deps: PipelineDeps,
  judged: Judged[],
): Promise<{ passed: Judged[]; rejected: Rejection[] }> {
  const passed: Judged[] = [];
  const rejected: Rejection[] = [];

  // One call per survivor, in parallel: they are independent, and this is the
  // slowest tier in the gauntlet. Isolated per call, like every neighbouring
  // gate (checkSources, runProbe, runResolution): one candidate's transient
  // 429 or 5xx must reject that candidate, not the whole `Promise.all` — and
  // with it the night, silently, with nothing written and no gauntlet
  // narration fired. Surplus is what makes throwing one candidate away
  // affordable.
  const outcomes: Outcome[] = await Promise.all(
    judged.map(async (j): Promise<Outcome> => {
      try {
        const verdict = await askResolver(deps, deps.models.preflight, {
          text: j.candidate.text,
          resolutionCriteria: j.candidate.resolution_criteria,
          sourceName: j.candidate.source_name,
          sourceUrl: j.candidate.source_url,
        });
        return { ok: true, verdict };
      } catch (err) {
        // A spent budget is a day-level stop, not one candidate's problem —
        // let it propagate and abort the gauntlet the way it already does
        // everywhere else a model call happens.
        if (err instanceof BudgetExhausted) throw err;
        return { ok: false, error: err };
      }
    }),
  );

  outcomes.forEach((o, i) => {
    const j = judged[i]!;
    if (!o.ok) {
      // "ambiguous" is already the critic's reason for the identical shape —
      // a model call this gate depends on came back unreadable, so there is
      // no verdict to judge. It is honest in a way "already-resolvable"
      // would not be (nothing was found already-resolvable) and in a way
      // "dead-source" would not be (the candidate's source_url was never
      // fetched here; the failure is the resolver call itself).
      rejected.push({
        text: j.candidate.text,
        reason: "ambiguous",
        detail: `preflight resolver call failed: ${o.error instanceof Error ? o.error.message : String(o.error)}`,
      });
      return;
    }
    const answer = settled(o.verdict);
    if (answer === null) {
      passed.push(j);
      return;
    }
    rejected.push({
      text: j.candidate.text,
      reason: "already-resolvable",
      detail: `${j.candidate.source_name} already answers this: ${answer}`,
    });
  });

  return { passed, rejected };
}
