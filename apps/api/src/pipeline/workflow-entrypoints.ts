// The three Workflow classes (design 2026-09-04 §2). Separate from
// workflows.ts on purpose: this is the only file in the pipeline that imports
// "cloudflare:workers", a specifier that resolves solely inside workerd, and
// only worker.ts imports it. workflows.ts keeps WorkflowStarter, hourBucket,
// bindingStarter and inlineStarter, all of which are plain TypeScript and
// testable without the runtime.
//
// Each class is a thin shell. All the work lives in ordinary async functions
// that take PipelineDeps, so every one of them is testable against PGlite with
// a fake Claude client — a Workflow class is not.
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
// NonRetryableError lives in "cloudflare:workflows", a separate workerd-only
// specifier from "cloudflare:workers" — @cloudflare/workers-types puts it
// there, not on the main module. Both imports stay confined to this one file.
import { NonRetryableError } from "cloudflare:workflows";
import { buildPipelineDeps, type WorkerEnv } from "../worker";
import { POLICY, type StepPolicy } from "./steps";
import { BudgetExhausted, meterClaude, reportBudgetExhaustion } from "./spend";
import { addDays, etNow, noonET, voidDeadline } from "./clock";
import { emptyTally, screenCandidates, type Rejection } from "./candidate";
import { gatherAuthoringContext, generateCandidates } from "./gauntlet/generate";
import { checkSources } from "./gauntlet/sources";
import { criticize } from "./gauntlet/critic";
import { gatherForecasts } from "./gauntlet/forecast";
import { preflightOne, assemblePreflight } from "./gauntlet/preflight";
import { tasteCheck } from "./gauntlet/taste";
import { assessEditorial } from "./editorial";
import { commitRound, narrateGauntlet } from "./gauntlet";
import { resolveOne, narrateResolution, type ResolveOutcome } from "./resolve";
import { probeOne, narrateProbe, type ProbeOutcome } from "./probe";
import type { PipelineDeps } from "./index";

interface Params { date: string; questionIds?: string[] }

// A Workflow instance builds its own deps from env — it is on the far side of
// the dispatch and shares nothing with the tick that started it. The spend
// ceiling therefore has to be applied here too, or every long call would escape
// the meter the moment the substrate started working.
function metered(env: WorkerEnv): PipelineDeps | null {
  const deps = buildPipelineDeps(env);
  if (!deps) return null;
  const et = etNow(new Date());
  return { ...deps, claude: deps.claude ? meterClaude(deps.db, deps.claude, et.date) : null };
}

/**
 * Every step in this file goes through here (design 2026-09-08 §4.3). Three
 * responsibilities, none of which any individual step should be trusted to
 * remember:
 *
 *  1. EXPLICIT CONFIG. The 10-minute default is never inherited — see §1.1.
 *  2. BUDGET MAPPING. BudgetExhausted is narrated once, then rethrown as
 *     NonRetryableError. Without this the meter charges on every one of five
 *     retries for zero work done, silently, because `first` is false after the
 *     call that crossed the line (§1.3).
 *  3. A SERIALISABLE SUMMARY, so instance.status() can show what happened.
 *
 * BudgetExhausted stays a plain Error in spend.ts; the mapping lives HERE
 * because this is the only file in the pipeline that may import
 * "cloudflare:workers".
 *
 * Exported so the BudgetExhausted → NonRetryableError mapping is a pure unit
 * test in the PGlite suite (test/pipeline-durable-step.test.ts): `step` is a
 * parameter here, so a fake `{ do: (_n, _c, cb) => cb() }` reaches this
 * function's own catch directly. That matters because the workerd
 * introspector's mockStepError/mockStepResult (apps/api/workflows-test/)
 * replace a step's real callback outright — this catch lives INSIDE that
 * callback, so no mocked workerd test can ever reach it. This export exists
 * for no other consumer.
 */
export async function durableStep<T extends Rpc.Serializable<T>>(
  step: WorkflowStep,
  name: string,
  policy: StepPolicy,
  deps: PipelineDeps,
  fn: () => Promise<T>,
): Promise<T> {
  // StepPolicy (steps.ts) types its durations as plain `string` so that file
  // can stay free of the "cloudflare:workers" import (see its header). The
  // real WorkflowStepConfig narrows them to a template-literal duration
  // shape — asserted here, at the one boundary where a policy meets the
  // Workflow engine, rather than by widening the engine's own type.
  const config = { timeout: policy.timeout, retries: policy.retries } as WorkflowStepConfig;
  return step.do(name, config, async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        // The narration must never be able to prevent the mapping below: if
        // reportBudgetExhaustion threw, an ordinary error would escape this
        // catch instead of a NonRetryableError, and the step would retry
        // under its policy — re-entering meterClaude and charging again,
        // which is defect §1.3 returning through the narration path. Today
        // this is safe only because makeTelegramClient.send swallows its own
        // errors (telegram.ts); the .catch makes that guarantee structural
        // here too, rather than borrowed from another file's invariant.
        await reportBudgetExhaustion(deps.telegram, err).catch(() => {});
        // NOT retryable. The ceiling has already been crossed; retrying
        // charges again and does no work.
        throw new NonRetryableError(err.message, "BudgetExhausted");
      }
      throw err;
    }
  });
}

export class AuthoringWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    const deps = metered(this.env);
    if (!deps) return;
    const { date } = event.payload;
    const tally = emptyTally();
    const count = (rs: Rejection[]) => rs.forEach((r) => (tally[r.reason] += 1));

    const ctx = await durableStep(step, "context", POLICY.context, deps, () =>
      gatherAuthoringContext(deps, date),
    );

    const raw = await durableStep(step, "generate", POLICY.model, deps, async () => {
      // `generateCandidates` returns `unknown[]` by design (candidate.ts
      // header) — it is unvalidated model output, and screenCandidates
      // below is the first thing that parses it. `T extends
      // Rpc.Serializable<T>` cannot prove a bare `unknown[]` is
      // serializable, since `unknown` could be a function or symbol; cast
      // to `object[]`, which DOES satisfy the constraint and is still
      // assignable everywhere `raw` is used below (screenCandidates takes
      // `unknown[]`).
      return (await generateCandidates(deps, date, ctx)) as object[];
    });

    const opensAt = noonET(date);
    const locksAtDefault = noonET(addDays(date, 1));

    // Tier 0 — free.
    // Mirror of gauntlet/index.ts's tier-0 call — keep the two runners in lockstep.
    const tier0 = await durableStep(step, "screen", POLICY.pure, deps, async () =>
      screenCandidates(raw, {
        rulesVersion: 2,
        opensAt,
        locksAtDefault,
        voidAt: voidDeadline(date),
        recentTopicKeys: new Set(ctx.recentTopicKeys),
      }),
    );
    count(tier0.rejected);

    // Tier 1 — one GET each.
    const tier1 = await durableStep(step, "sources", POLICY.sourceFetch, deps, () =>
      checkSources(deps.sourceFetch ?? fetch, tier0.passed),
    );
    count(tier1.rejected);

    // Tier 2 — the public forecast (its own step: a fetch, checkpointed as a
    // plain object), then one model call, plus §7's contestedness gate.
    const forecasts = await durableStep(step, "forecasts", POLICY.sourceFetch, deps, () =>
      gatherForecasts(deps.sourceFetch ?? fetch, tier1.passed),
    );
    const tier2 = await durableStep(step, "critic", POLICY.model, deps, () =>
      criticize(deps, tier1.passed, forecasts),
    );
    count(tier2.rejected);

    // Tier 3 — THE FAN-OUT. One step per survivor, named by position over the
    // checkpointed `critic` output so replays reproduce the same names
    // (design 2026-09-08 §3.1).
    const outcomes = await Promise.all(
      tier2.judged.map((j, i) =>
        durableStep(step, `preflight-${i}`, POLICY.modelWide, deps, () => preflightOne(deps, j, i)),
      ),
    );
    const tier3 = assemblePreflight(tier2.judged, outcomes);
    count(tier3.rejected);

    // Tier 4 — last, and fail-closed. POLICY.failClosed is zero-retry so the
    // guarantee is declared rather than emergent (design 2026-09-08 §5.1).
    const tier4 = await durableStep(step, "taste", POLICY.failClosed, deps, () =>
      tasteCheck(deps, tier3.passed),
    );
    count(tier4.rejected);

    const edited = await durableStep(step, "editorial", POLICY.model, deps, () =>
      assessEditorial(deps, tier4.passed, opensAt),
    );
    tally.editorial += tier4.passed.length - edited.length;

    const result = await durableStep(step, "commit", POLICY.db, deps, () =>
      commitRound(deps, date, raw.length, tally, edited),
    );

    await durableStep(step, "narrate", POLICY.narrate, deps, async () => {
      await narrateGauntlet(deps, date, result);
      return { published: result.published };
    });

    return result;
  }
}

export class ResolutionWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    const deps = metered(this.env);
    if (!deps) return;
    const { date, questionIds = [] } = event.payload;

    // SEQUENTIAL, deliberately (design 2026-09-08 §3.2). Each step carries its
    // own timeout, which is what removes the 10-minute cap; parallelising would
    // additionally cut wall-clock but take peak Anthropic concurrency from two
    // to ten, which is a separate decision.
    const outcomes: ResolveOutcome[] = [];
    for (const questionId of questionIds) {
      outcomes.push(
        await durableStep(step, `resolve-${questionId}`, POLICY.noRetry, deps, () =>
          resolveOne(deps, questionId),
        ),
      );
    }

    await durableStep(step, "narrate", POLICY.narrate, deps, async () => {
      await narrateResolution(deps, date, outcomes);
      return { failed: outcomes.filter((o) => o.error).length };
    });

    return { resolved: outcomes.filter((o) => o.resolved).length, total: outcomes.length };
  }
}

export class ProbeWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    const deps = metered(this.env);
    if (!deps) return;
    const { date, questionIds = [] } = event.payload;

    const outcomes: ProbeOutcome[] = [];
    for (const questionId of questionIds) {
      outcomes.push(
        await durableStep(step, `probe-${questionId}`, POLICY.noRetry, deps, () =>
          probeOne(deps, questionId),
        ),
      );
    }

    await durableStep(step, "narrate", POLICY.narrate, deps, async () => {
      await narrateProbe(deps, date, outcomes);
      return { healed: outcomes.filter((o) => o.healed).length };
    });

    return { healed: outcomes.filter((o) => o.healed).length, total: outcomes.length };
  }
}
