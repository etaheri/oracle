// The two Workflow classes (design 2026-09-04 §2). Separate from
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
import { MODEL_MEMBER_IDS } from "@oracle/core";
import { schema } from "../db/client";
import { buildPipelineDeps, type WorkerEnv } from "../worker";
import { POLICY, type StepPolicy } from "./steps";
import { BudgetExhausted, meterClaude, reportBudgetExhaustion } from "./spend";
import { etNow } from "./clock";
import { buildMarketDraft, commitMarketDraft, fetchCandidates, narrateMarketRound, tooFewReason } from "./market-round";
import { buildOpinionDraft, narrateOpinionRound, opinionResult } from "./opinion-round";
import { SELECT } from "./exchanges/select";
import { resolveOne, narrateResolution, type ResolveOutcome } from "./resolve";
import { councilEditable, narrateCouncil, type CouncilRun } from "./council";
import { retrieveEvidence } from "./council/evidence";
import { commitMember, type MemberResult } from "./council/member";
import { commitCouncil } from "./council/commit";
import { writeLessons } from "./council/lessons";
import { roundKindOf, type RoundKind } from "./round-kind";
import type { MarketCandidate } from "./exchanges/types";
import type { PipelineDeps } from "./index";
import type { WorkflowParams } from "./workflows";

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

export class AuthoringWorkflow extends WorkflowEntrypoint<WorkerEnv, WorkflowParams> {
  async run(event: Readonly<WorkflowEvent<WorkflowParams>>, step: WorkflowStep) {
    const deps = metered(this.env);
    if (!deps) return;
    const { date } = event.payload;
    // The kind on the payload wins (an admin one-off); otherwise the
    // deployment's PIPELINE_ROUND_KIND (design 2026-09-22 T3).
    const kind: RoundKind = event.payload.roundKind ?? roundKindOf(deps);
    const editable = await durableStep(step, "editable", POLICY.db, deps, async () => {
      const r = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
      return !(r && (r.status !== "scheduled" || r.oracleCommittedAt !== null));
    });
    if (!editable) return;
    // An opinion round has no candidates: the step returns an empty pool
    // without touching an exchange (§4).
    const { fetched, candidates } = await durableStep(step, "candidates", POLICY.sourceFetch, deps, () =>
      kind === "opinion" ? Promise.resolve({ fetched: 0, candidates: [] as MarketCandidate[] }) : fetchCandidates(deps, date));
    const built = await durableStep(step, "draft", POLICY.model, deps, async () => {
      if (kind === "opinion") return buildOpinionDraft(deps, date);
      if (candidates.length < SELECT.ROUND_SIZE) return { draft: null, reason: tooFewReason(candidates.length) };
      return buildMarketDraft(deps, date, candidates);
    });
    const result = await durableStep(step, "commit", POLICY.db, deps, async () => {
      if (built.draft) await commitMarketDraft(deps, date, built.draft); // upsertDraft at version 3; shared by both kinds
      return { published: built.draft !== null, fetched, eligible: candidates.length, reason: built.reason };
    });
    await durableStep(step, "narrate", POLICY.narrate, deps, () =>
      kind === "opinion"
        ? narrateOpinionRound(deps, date, opinionResult(built.draft, built.reason))
        : narrateMarketRound(deps, date, result));
  }
}

export class ResolutionWorkflow extends WorkflowEntrypoint<WorkerEnv, WorkflowParams> {
  async run(event: Readonly<WorkflowEvent<WorkflowParams>>, step: WorkflowStep) {
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
      // Memory (design 2026-09-11 §8): its own step, after the outcome is
      // known, so a retried resolve never re-asks and a failed lesson never
      // fails the resolution. No-op below version 3 and on void.
      await durableStep(step, `lessons-${questionId}`, POLICY.model, deps, () => writeLessons(deps, questionId));
    }

    await durableStep(step, "narrate", POLICY.narrate, deps, async () => {
      await narrateResolution(deps, date, outcomes);
      return { failed: outcomes.filter((o) => o.error).length };
    });

    return { resolved: outcomes.filter((o) => o.resolved).length, total: outcomes.length };
  }
}

export class CouncilWorkflow extends WorkflowEntrypoint<WorkerEnv, WorkflowParams> {
  async run(event: Readonly<WorkflowEvent<WorkflowParams>>, step: WorkflowStep) {
    const deps = metered(this.env);
    if (!deps) return;
    const { date } = event.payload;
    const editable = await durableStep(step, "editable", POLICY.db, deps, () => councilEditable(deps, date));
    if (!editable) return { committed: false, reason: "not editable" };
    const evidence = await durableStep(step, "evidence", POLICY.sourceFetch, deps, () => retrieveEvidence(deps, date));
    // One step per member (design 2026-09-11 §4.2): a timeout in one cannot
    // lose the others, and a retry of the commit step never re-asks a model.
    const members: MemberResult[] = [];
    for (const m of MODEL_MEMBER_IDS) {
      members.push(await durableStep(step, `member-${m}`, POLICY.modelWide, deps, () => commitMember(deps, date, m)));
    }
    const commit = await durableStep(step, "commit", POLICY.db, deps, () => commitCouncil(deps, date, members));
    const run: CouncilRun = { editable: true, evidence, members, commit };
    await durableStep(step, "narrate", POLICY.narrate, deps, async () => { await narrateCouncil(deps, date, run); return { narrated: true }; });
    return { committed: commit.committed, reason: commit.reason, lines: commit.lines };
  }
}
