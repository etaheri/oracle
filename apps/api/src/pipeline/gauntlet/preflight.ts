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

export async function preflight(
  deps: PipelineDeps,
  judged: Judged[],
): Promise<{ passed: Judged[]; rejected: Rejection[] }> {
  const passed: Judged[] = [];
  const rejected: Rejection[] = [];

  // One call per survivor, in parallel: they are independent, and this is the
  // slowest tier in the gauntlet.
  const verdicts = await Promise.all(
    judged.map((j) =>
      askResolver(deps, deps.models.preflight, {
        text: j.candidate.text,
        resolutionCriteria: j.candidate.resolution_criteria,
        sourceName: j.candidate.source_name,
        sourceUrl: j.candidate.source_url,
      }),
    ),
  );

  verdicts.forEach((v, i) => {
    const j = judged[i]!;
    const answer = settled(v);
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
