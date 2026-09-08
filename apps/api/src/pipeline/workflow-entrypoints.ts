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
import { etNow } from "./clock";
import { runAuthoringGauntlet } from "./gauntlet";
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
 */
async function durableStep<T extends Rpc.Serializable<T>>(
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
        await reportBudgetExhaustion(deps.telegram, err);
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
    // Still one step covering the whole gauntlet — Task 9 (design 2026-09-08
    // §3.1, Phase 2) is what splits this into nine steps plus the fan-out.
    // The policy below reproduces Cloudflare's own default verbatim, so this
    // class's behaviour is unchanged; only its budget mapping now goes
    // through durableStep instead of the deleted narrating().
    await durableStep(
      step,
      "gauntlet",
      { timeout: "10 minutes", retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } },
      deps,
      () => runAuthoringGauntlet(deps, event.payload.date),
    );
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
