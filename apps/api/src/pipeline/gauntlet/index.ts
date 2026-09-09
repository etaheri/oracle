// The gauntlet, end to end (design 2026-09-04 §3, §4, §9.2).
//
// ORDER IS LOAD-BEARING, cheapest first:
//   0 structural   free
//   1 sources      one HTTP GET each, no model
//   2 critic       ONE model call for the whole set — and §7's contestedness
//                  gate, decided from the number that call already produced
//   3 pre-flight   one model call PER SURVIVOR — the most expensive tier, so
//                  it runs after §7 has already thinned the set
//   4 taste        last, and fail-closed, so its blast radius is smallest
//   then selection
//
// Nothing here can promote a rejected candidate. Each tier hands the next its
// survivors and its rejections separately, and the rejected list is only ever
// counted.
import { eq } from "drizzle-orm";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { addDays, fastResolveBy, noonET, voidDeadline } from "../clock";
import { upsertDraft } from "../draft";
import { emptyTally, screenCandidates, type RejectReason, type Rejection } from "../candidate";
import { assessEditorial, type Edited } from "../editorial";
import { gatherAuthoringContext, generateCandidates } from "./generate";
import { checkSources } from "./sources";
import { criticize } from "./critic";
import { gatherForecasts } from "./forecast";
import { preflight } from "./preflight";
import { tasteCheck } from "./taste";
import { selectRound } from "./select";

export interface GauntletResult {
  written: number;
  rejected: number;
  tally: Record<RejectReason, number>;
  published: boolean;
  relaxed: boolean;
}

// Counts, not a table (design 2026-09-04 §9.2). Persisting every rejected
// candidate is the version that supports precise tuning; the counts answer
// most of what anyone would ask, at zero schema cost, and promoting this to a
// stored table later is purely additive.
function narrate(date: string, written: number, published: boolean, tally: Record<RejectReason, number>, relaxed: boolean): string {
  const reasons = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} ${reason}`)
    .join(" · ");
  return [
    `HERMES · GAUNTLET ${date}`,
    `${written} candidates → ${published ? 5 : 0} published${relaxed ? " (categories relaxed to three)" : ""}`,
    `rejected: ${reasons || "none"}`,
  ].join("\n");
}

/**
 * Selection plus both writes. Idempotent by construction: upsertDraft is an
 * upsert and the counter update sets fixed values, so a retry of this step
 * lands the same round twice with the same content.
 *
 * No selection is not a failure — `publish-bank` already covers noon, and
 * the noon alert already in decideActions fires if the bank is empty too. A
 * drop that does not happen is the correct outcome for a ledger whose brand
 * is that it does not lie.
 */
export async function commitRound(
  deps: PipelineDeps,
  date: string,
  written: number,
  tally: Record<RejectReason, number>,
  edited: Edited[],
): Promise<GauntletResult> {
  const rejected = Object.values(tally).reduce((a, b) => a + b, 0);
  const selection = selectRound(edited, { fastBy: fastResolveBy(date) });
  if (!selection) return { written, rejected, tally, published: false, relaxed: false };

  await upsertDraft(deps.db, date, selection.draft, 2);
  await deps.db
    .update(schema.rounds)
    .set({ candidatesWritten: written, candidatesRejected: rejected })
    .where(eq(schema.rounds.date, date));

  return { written, rejected, tally, published: true, relaxed: selection.relaxed };
}

/** Terminal narration — its own step, so no earlier retry re-sends it. */
export async function narrateGauntlet(deps: PipelineDeps, date: string, r: GauntletResult): Promise<void> {
  await deps.telegram.send(narrate(date, r.written, r.published, r.tally, r.relaxed));
}

export async function runAuthoringGauntlet(deps: PipelineDeps, date: string): Promise<GauntletResult> {
  const tally = emptyTally();
  const count = (rejections: Rejection[]) => rejections.forEach((r) => (tally[r.reason] += 1));

  const ctx = await gatherAuthoringContext(deps, date);
  const raw = await generateCandidates(deps, date, ctx);
  const written = raw.length;

  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));

  // Tier 0 — free.
  const tier0 = screenCandidates(raw, { rulesVersion: 2, opensAt, locksAtDefault, voidAt: voidDeadline(date), recentTopicKeys: new Set(ctx.recentTopicKeys) });
  count(tier0.rejected);

  // Tier 1 — one GET each.
  const tier1 = await checkSources(deps.sourceFetch ?? fetch, tier0.passed);
  count(tier1.rejected);

  // Tier 2 — the public forecast for weather, then one model call, plus §7.
  const forecasts = await gatherForecasts(deps.sourceFetch ?? fetch, tier1.passed);
  const tier2 = await criticize(deps, tier1.passed, forecasts);
  count(tier2.rejected);

  // Tier 3 — one model call per survivor.
  const tier3 = await preflight(deps, tier2.judged);
  count(tier3.rejected);

  // Tier 4 — last, fail-closed.
  const tier4 = await tasteCheck(deps, tier3.passed);
  count(tier4.rejected);

  const editorial = await assessEditorial(deps, tier4.passed, opensAt);
  tally.editorial += tier4.passed.length - editorial.length;

  const result = await commitRound(deps, date, written, tally, editorial);
  await narrateGauntlet(deps, date, result);
  return result;
}
