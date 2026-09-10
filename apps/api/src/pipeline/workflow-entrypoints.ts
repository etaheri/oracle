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
import { eq } from "drizzle-orm";
import { schema } from "../db/client";
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
import { buildMarketDraft, commitMarketDraft, fetchCandidates, narrateMarketRound, tooFewReason } from "./market-round";
import { SELECT } from "./exchanges/select";
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
    const editable = await durableStep(step, "editable", POLICY.db, deps, async () => {
      const r = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
      return !(r && (r.status !== "scheduled" || r.oracleCommittedAt !== null));
    });
    if (!editable) return;
    const { fetched, candidates } = await durableStep(step, "candidates", POLICY.sourceFetch, deps, () => fetchCandidates(deps, date));
    const built = await durableStep(step, "draft", POLICY.model, deps, async () => {
      if (candidates.length < SELECT.ROUND_SIZE) return { draft: null, reason: tooFewReason(candidates.length) };
      return buildMarketDraft(deps, date, candidates);
    });
    const result = await durableStep(step, "commit", POLICY.db, deps, async () => {
      if (!built.draft) return { published: false, fetched, eligible: candidates.length, reason: built.reason };
      await commitMarketDraft(deps, date, built.draft);
      return { published: true, fetched, eligible: candidates.length, reason: null };
    });
    await durableStep(step, "narrate", POLICY.narrate, deps, () => narrateMarketRound(deps, date, result));
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
