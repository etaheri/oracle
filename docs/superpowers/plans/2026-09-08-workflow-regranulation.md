# Workflow Re-granulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn three single-step Cloudflare Workflows into properly checkpointed multi-step durable workflows, fix the four defects that follow from the current granularity, and add the instruments (usage capture, step observability, workerd step tests, gate evals) that make the substrate measurable.

**Architecture:** Three layers stay separable — `decideActions` owns cadence (unchanged), Workflow steps own checkpointing/retry/cost envelope (rebuilt), the runners own judgement (refactored into per-unit functions so both a step and the inline fallback can drive them). Every long runner becomes a pure async function over `PipelineDeps` that a `step.do` calls; `inlineStarter` keeps calling the same functions in-process, so the existing PGlite suite stays the regression net.

**Tech Stack:** Cloudflare Workflows (`WorkflowEntrypoint`, `step.do`, `NonRetryableError`), Hono on Workers, Drizzle over neon-http, PGlite + vitest for the main suite, Cloudflare's vitest integration for step semantics, zod.

**Spec:** `docs/superpowers/specs/2026-09-08-workflow-regranulation-design.md` — read it first. Every retry limit, timeout, and behavioural guarantee below is copied from it.

## Global Constraints

- **No new runtime npm dependencies.** Cloudflare's vitest integration is a dev dependency only; nothing new ships to the Worker.
- **`neon-http` has NO interactive transactions.** Every new write is a single atomic statement, modelled on `chargeCall` (`spend.ts:44-47`).
- **No live network calls in the PGlite suite.** Claude, Telegram, market feeds and source fetches stay injectable.
- **`decideActions` stays pure** over `(ETNow, PipelineState)`. Do not move cadence into a workflow.
- **`ClaudeClient` stays a one-method interface.** `structured(call): Promise<unknown>`. Widening it breaks the claim at `spend.ts:11` that the ceiling is applied in one place. Usage is reported through a separate constructor callback, never through the return type.
- **`cloudflare:workers` is imported by exactly one pipeline file**: `src/pipeline/workflow-entrypoints.ts`. Anything importing it is untestable in the PGlite suite. `workflows.ts` stays plain TypeScript.
- **`BudgetExhausted` stays a plain `Error`** in `spend.ts`. The mapping to `NonRetryableError` happens only in `workflow-entrypoints.ts`.
- **Taste stays fail-closed.** `retries: { limit: 0 }` on that step, and its internal catch keeps converting every non-budget error to `rejectAll`.
- **The ceiling stays 150 CALLS.** Do not convert it to dollars. Usage capture is an instrument and gates nothing.
- **ET time only** via `Intl.DateTimeFormat` with `America/New_York` (`clock.ts`).
- Run api commands from `apps/api/`. Full check: `npx vitest run` and `npx tsc --noEmit`.
- Branch: `workflow-regranulation`. Commit after every task.

## File Structure

**Created:**
- `apps/api/src/pipeline/steps.ts` — `durableStep()`: the one place step config, budget mapping and step summaries live.
- `apps/api/src/pipeline/usage.ts` — `CallUsage`, `recordUsage()`. Instrument only.
- `apps/api/test/workflows/` — the workerd step-semantics suite (separate vitest project).
- `apps/api/eval/` — gate eval harness (`critic.eval.ts`, `taste.eval.ts`, `resolver.eval.ts`, `run.ts`, `fixtures/`).
- `apps/api/vitest.workflows.config.ts` — workerd project config.

**Modified:**
- `workflow-entrypoints.ts` — the three classes become multi-step.
- `resolve.ts`, `probe.ts` — split into per-question units + narration.
- `gauntlet/index.ts` — split into tier functions the workflow composes.
- `gauntlet/generate.ts` — `gatherAuthoringContext` split out.
- `gauntlet/preflight.ts` — `preflightOne` split out.
- `gauntlet/taste.ts` — re-throw `BudgetExhausted`.
- `claude.ts` — `onUsage` callback.
- `db/schema.ts` + new drizzle migration — `pipeline_usage` table.
- `routes/admin.ts`, `worker.ts`, `test/stubs/cloudflare-workers.ts`, `package.json`.

---

# PHASE 1 — Correctness (the live-bug fix)

Phase 1 addresses spec §1.1, §1.3 and §1.4. It is independently shippable and is the only phase that fixes a defect capable of breaking an unattended night.

---

### Task 1: `NonRetryableError` in the test stub

**Files:**
- Modify: `apps/api/test/stubs/cloudflare-workers.ts`

**Interfaces:**
- Produces: `class NonRetryableError extends Error` — used by every later task in `workflow-entrypoints.ts`.

The stub currently exports only `WorkflowEntrypoint`. Task 2 imports `NonRetryableError` from `cloudflare:workers`, and without this the whole api suite fails to resolve.

- [ ] **Step 1: Add the export**

```ts
// Cloudflare's NonRetryableError: thrown inside a step to stop retries dead.
// The real one carries the same shape; tests only need `instanceof` to work
// and the name to survive, which is what workflow-entrypoints.ts asserts on.
export class NonRetryableError extends Error {
  constructor(message: string, name = "NonRetryableError") {
    super(message);
    this.name = name;
  }
}
```

- [ ] **Step 2: Verify the suite still resolves**

Run: `npx vitest run test/pipeline-tick.test.ts`
Expected: PASS (unchanged behaviour; this only adds an export)

- [ ] **Step 3: Commit**

```bash
git add test/stubs/cloudflare-workers.ts
git commit -m "test(stubs): NonRetryableError, so entrypoints can stop a retry dead"
```

---

### Task 2: The taste gate must let `BudgetExhausted` through

**Files:**
- Modify: `apps/api/src/pipeline/gauntlet/taste.ts:82-85`
- Test: `apps/api/test/gauntlet-taste.test.ts`

**Interfaces:**
- Consumes: `BudgetExhausted` from `../spend`.
- Produces: no signature change. `tasteCheck` now throws `BudgetExhausted` instead of swallowing it.

This is spec §1.4 / §4.4 — the defect found while specifying. `preflight.ts:58` already re-throws `BudgetExhausted` because a spent budget is a day-level stop; taste swallows it, so exhaustion landing on the taste call stops the day **silently** and the ‼️ critical never fires.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/gauntlet-taste.test.ts`:

```ts
import { BudgetExhausted } from "../src/pipeline/spend";

it("lets a spent budget through instead of failing the batch closed", async () => {
  const deps = {
    claude: {
      structured: async () => {
        throw new BudgetExhausted("2026-09-08", 151, true);
      },
    },
    models: { taste: "m" },
  } as unknown as PipelineDeps;

  const judged = [{ candidate: { text: "Will it rain?" }, criticProbability: 0.5 }] as never;
  // A day-level stop must PROPAGATE. Converting it to rejectAll makes the
  // night end silently with no critical alert — the defect this test pins.
  await expect(tasteCheck(deps, judged)).rejects.toBeInstanceOf(BudgetExhausted);
});

it("still fails closed on any other error", async () => {
  const deps = {
    claude: { structured: async () => { throw new Error("429 rate limited"); } },
    models: { taste: "m" },
  } as unknown as PipelineDeps;

  const judged = [{ candidate: { text: "Will it rain?" }, criticProbability: 0.5 }] as never;
  const out = await tasteCheck(deps, judged);
  expect(out.passed).toHaveLength(0);
  expect(out.rejected).toHaveLength(1);
  expect(out.rejected[0]!.reason).toBe("taste");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/gauntlet-taste.test.ts`
Expected: FAIL — the first test gets a resolved `rejectAll` result instead of a rejection.

- [ ] **Step 3: Implement**

In `taste.ts`, change the catch block:

```ts
  } catch (err) {
    // A spent budget is a day-level stop, not one batch's problem — let it
    // propagate exactly as preflight.ts does, so reportBudgetExhaustion sees
    // it and the ‼️ critical actually fires. Every OTHER error still fails
    // closed: a taste check that fails open is not a taste check.
    if (err instanceof BudgetExhausted) throw err;
    return rejectAll(judged, `the taste gate could not be reached, so the batch was refused: ${err instanceof Error ? err.message : String(err)}`);
  }
```

Add the import: `import { BudgetExhausted } from "../spend";`

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/gauntlet-taste.test.ts test/gauntlet-run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/gauntlet/taste.ts test/gauntlet-taste.test.ts
git commit -m "fix(taste): a spent budget is a day-level stop, not a refused batch"
```

---

### Task 3: `durableStep()` — the one place step policy lives

**Files:**
- Create: `apps/api/src/pipeline/steps.ts`
- Test: `apps/api/test/pipeline-steps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StepPolicy { timeout: string; retries: { limit: number; delay: string; backoff?: "exponential" | "linear" | "constant" } }
  export const POLICY: Record<"context" | "model" | "modelWide" | "sourceFetch" | "pure" | "db" | "narrate" | "failClosed" | "noRetry", StepPolicy>
  ```
  Every later task selects a policy by name rather than writing literals.

Policies are named after the KIND of work, not the step, so two steps doing the same kind of work cannot drift apart. Values come from spec §3.1 and §4.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/pipeline-steps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { POLICY } from "../src/pipeline/steps";

describe("step policies", () => {
  it("never inherits the 10-minute default timeout", () => {
    // Spec §4.2: an inherited timeout is the defect in §1.1. Every policy
    // must state its own, and every one must be under the default.
    for (const [name, p] of Object.entries(POLICY)) {
      expect(p.timeout, name).toBeDefined();
      expect(p.timeout, name).not.toBe("10 minutes");
    }
  });

  it("gives the fail-closed and no-retry policies zero retries", () => {
    // Spec §5.1: taste's guarantee must be DECLARED, not emergent.
    // Spec §4.1: resolve/probe steps take limit 0 because the hourly cron IS
    // their retry layer.
    expect(POLICY.failClosed.retries.limit).toBe(0);
    expect(POLICY.noRetry.retries.limit).toBe(0);
  });

  it("keeps the wide model fan-out shallow", () => {
    // Spec §3.1: preflight is 12 wide; limit 1 caps it at 24 calls.
    expect(POLICY.modelWide.retries.limit).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/pipeline-steps.test.ts`
Expected: FAIL — cannot resolve `../src/pipeline/steps`

- [ ] **Step 3: Implement**

Create `apps/api/src/pipeline/steps.ts`:

```ts
// Step policy, in one place (design 2026-09-08 §4.2).
//
// THE DEFAULT IS NEVER INHERITED. Cloudflare's default step config is
// `{ retries: { limit: 5, delay: 10s, backoff: exponential }, timeout: "10 minutes" }`,
// and that inherited 10 minutes is the whole of defect §1.1: a single step
// wrapping five sequential resolves re-created the cap the Workflow substrate
// was adopted to escape.
//
// Policies are named after the KIND of work rather than the step that uses
// them, so two steps doing the same kind of work cannot drift apart, and a new
// step has to CHOOSE a policy rather than invent one.
//
// This file is plain TypeScript on purpose — it imports nothing from
// "cloudflare:workers", so the policies are assertable in the PGlite suite.
export interface StepPolicy {
  timeout: string;
  retries: { limit: number; delay: string; backoff?: "exponential" | "linear" | "constant" };
}

export const POLICY = {
  /** DB reads plus keyless HTTP feeds. Cheap, safe to repeat. */
  context: { timeout: "2 minutes", retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },

  /** One model call with web search. The common case. */
  model: { timeout: "8 minutes", retries: { limit: 2, delay: "20 seconds", backoff: "exponential" } },

  /**
   * One model call inside an N-wide fan-out. Shallower than `model` because
   * the limit multiplies by the fan-out width: 12 candidates at limit 1 is 24
   * calls worst case, against a 150/day ceiling (spec §4.5).
   */
  modelWide: { timeout: "8 minutes", retries: { limit: 1, delay: "20 seconds", backoff: "exponential" } },

  /** N parallel GETs, each already capped at SOURCE_TIMEOUT_MS internally. */
  sourceFetch: { timeout: "2 minutes", retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },

  /** Deterministic compute. Retried only to survive an engine restart. */
  pure: { timeout: "1 minute", retries: { limit: 3, delay: "1 second", backoff: "constant" } },

  /** Idempotent writes — upserts and fixed-value updates. */
  db: { timeout: "2 minutes", retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },

  /** Terminal narration. Best-effort, never load-bearing (spec §5.2). */
  narrate: { timeout: "1 minute", retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },

  /**
   * The taste gate (spec §5.1). Zero retries so the fail-closed guarantee is
   * DECLARED rather than emergent — tasteCheck catches internally today, but a
   * future edit that let an error escape must not silently gain a retry.
   */
  failClosed: { timeout: "5 minutes", retries: { limit: 0, delay: "1 second" } },

  /**
   * Resolve and probe model steps (spec §4.1). The hourly cron re-dispatch IS
   * their retry layer, and it is already scoped per question by the DB, so an
   * inner retry buys nothing an outer one does not — it only multiplies.
   */
  noRetry: { timeout: "9 minutes", retries: { limit: 0, delay: "1 second" } },
} as const satisfies Record<string, StepPolicy>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/pipeline-steps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/steps.ts test/pipeline-steps.test.ts
git commit -m "feat(pipeline): name step policies by kind of work, never inherit the default"
```

---

### Task 4: Split `runResolution` into a per-question unit

**Files:**
- Modify: `apps/api/src/pipeline/resolve.ts:92-103`
- Test: `apps/api/test/pipeline-resolve.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ResolveOutcome { questionId: string; resolved: boolean; error?: string }
  export async function resolveOne(deps: PipelineDeps, questionId: string): Promise<ResolveOutcome>
  export function narrateResolution(deps: PipelineDeps, date: string, outcomes: ResolveOutcome[]): Promise<void>
  export async function runResolution(deps: PipelineDeps, date: string, questionIds: string[]): Promise<ResolveOutcome[]>
  ```
- `resolveOne` throws ONLY `BudgetExhausted`; every other error is captured into `error`. This is what lets a step return a summary rather than fail.
- Task 6 (`ResolutionWorkflow`) calls `resolveOne` per step and `narrateResolution` in a terminal step.
- `runResolution` keeps its name and stays the inline path, so `inlineStarter` and every existing test are untouched — but it now returns the outcomes rather than `void`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/pipeline-resolve.test.ts`:

```ts
import { resolveOne, narrateResolution } from "../src/pipeline/resolve";

it("resolveOne captures a failure instead of throwing it", async () => {
  const { db } = await makeTestDb();
  const sent: string[] = [];
  const deps = makeDeps(db, sent, {
    structured: async () => { throw new Error("upstream 503"); },
  });
  const qid = await seedLockedQuestion(db);

  const out = await resolveOne(deps, qid);
  expect(out).toEqual({ questionId: qid, resolved: false, error: "upstream 503" });
  // A step returns a SUMMARY. Narration is a separate, terminal step, so
  // resolveOne must not send anything itself.
  expect(sent).toEqual([]);
});

it("resolveOne still propagates a spent budget", async () => {
  const { db } = await makeTestDb();
  const deps = makeDeps(db, [], {
    structured: async () => { throw new BudgetExhausted("2026-09-08", 151, true); },
  });
  const qid = await seedLockedQuestion(db);
  await expect(resolveOne(deps, qid)).rejects.toBeInstanceOf(BudgetExhausted);
});

it("narrateResolution sends one line per failure and nothing when all resolved", async () => {
  const sent: string[] = [];
  const deps = { telegram: { send: async (t: string) => void sent.push(t) } } as unknown as PipelineDeps;

  await narrateResolution(deps, "2026-09-08", [{ questionId: "q1", resolved: true }]);
  expect(sent).toEqual([]);

  await narrateResolution(deps, "2026-09-08", [
    { questionId: "q1", resolved: true },
    { questionId: "q2", resolved: false, error: "upstream 503" },
  ]);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("upstream 503");
  expect(sent[0]).toContain("2026-09-08");
});
```

`makeDeps` and `seedLockedQuestion` already exist in this file — reuse them; if the local helper is named differently, adapt rather than duplicate.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/pipeline-resolve.test.ts`
Expected: FAIL — `resolveOne` is not exported

- [ ] **Step 3: Implement**

Replace `runResolution` in `resolve.ts` with:

```ts
export interface ResolveOutcome {
  questionId: string;
  resolved: boolean;
  error?: string;
}

/**
 * One question, resolved or not, as a VALUE rather than an effect.
 *
 * This is the unit a Workflow step drives (design 2026-09-08 §3.2). It throws
 * only BudgetExhausted — a day-level stop that must reach the entrypoint's
 * mapper and become a NonRetryableError. Every other failure is captured into
 * the outcome, because one failing read must never stall the others and a step
 * that returns a summary is one a later step can narrate.
 */
export async function resolveOne(deps: PipelineDeps, questionId: string): Promise<ResolveOutcome> {
  try {
    const resolved = await resolveWithClaude(deps, questionId);
    return { questionId, resolved };
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return { questionId, resolved: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Terminal narration (design 2026-09-08 §5.2). Its own step, so that a retry
 * of an EARLIER step can never re-send it — which is what today's in-loop
 * sends do.
 */
export async function narrateResolution(
  deps: PipelineDeps,
  date: string,
  outcomes: ResolveOutcome[],
): Promise<void> {
  const failed = outcomes.filter((o) => o.error);
  if (failed.length === 0) return;
  await deps.telegram.send(
    `⚠ resolve failed (${date}): ${failed.map((f) => `${f.questionId}: ${f.error}`).join(" · ")}`,
  );
}

/**
 * The INLINE path — `wrangler dev`, tests, and any deployment without Workflow
 * bindings. Identical work, same order, in-process. The Workflow drives
 * resolveOne per step instead; both share the unit, which is why the two paths
 * cannot drift.
 */
export async function runResolution(
  deps: PipelineDeps,
  date: string,
  questionIds: string[],
): Promise<ResolveOutcome[]> {
  const outcomes: ResolveOutcome[] = [];
  for (const questionId of questionIds) {
    outcomes.push(await resolveOne(deps, questionId));
  }
  await narrateResolution(deps, date, outcomes);
  return outcomes;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. Existing resolve tests assert on the Telegram text; narration is now batched into one line, so update any test asserting one message per failure to assert on the single combined line.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/resolve.ts test/pipeline-resolve.test.ts
git commit -m "refactor(resolve): one question is a value, narration is terminal"
```

---

### Task 5: Split `runProbe` into a per-question unit

**Files:**
- Modify: `apps/api/src/pipeline/probe.ts:56-74`
- Test: `apps/api/test/pipeline-probe.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProbeOutcome { questionId: string; healed: boolean; slot?: number; text?: string; error?: string }
  export async function probeOne(deps: PipelineDeps, questionId: string): Promise<ProbeOutcome>
  export function narrateProbe(deps: PipelineDeps, date: string, outcomes: ProbeOutcome[]): Promise<void>
  export async function runProbe(deps: PipelineDeps, date: string, questionIds: string[]): Promise<ProbeOutcome[]>
  ```
- `runProbe` previously returned `number` (healed count). It now returns the outcomes; callers wanting the count use `outcomes.filter(o => o.healed).length`.

Mirrors Task 4 exactly. The heal narration currently fires inside the loop (`probe.ts:66`) and re-reads the question to get its slot and text; `probeOne` returns those in the outcome so the terminal step needs no second read.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/pipeline-probe.test.ts`:

```ts
import { probeOne, narrateProbe } from "../src/pipeline/probe";

it("probeOne returns the slot and text a narrator needs, without narrating", async () => {
  const { db } = await makeTestDb();
  const sent: string[] = [];
  const deps = makeDeps(db, sent, { /* resolver answers "yes" — see existing helper */ });
  const qid = await seedOpenQuestionWithLateLock(db);

  const out = await probeOne(deps, qid);
  expect(out.healed).toBe(true);
  expect(out.slot).toBeTypeOf("number");
  expect(out.text).toBeTypeOf("string");
  expect(sent).toEqual([]);
});

it("narrateProbe sends one line per heal and nothing when none healed", async () => {
  const sent: string[] = [];
  const deps = { telegram: { send: async (t: string) => void sent.push(t) } } as unknown as PipelineDeps;

  await narrateProbe(deps, "2026-09-08", [{ questionId: "q1", healed: false }]);
  expect(sent).toEqual([]);

  await narrateProbe(deps, "2026-09-08", [
    { questionId: "q1", healed: true, slot: 3, text: "Will it rain?" },
  ]);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("slot 3");
  expect(sent[0]).toContain("Will it rain?");
});
```

Adapt the helper names to whatever `pipeline-probe.test.ts` already defines.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/pipeline-probe.test.ts`
Expected: FAIL — `probeOne` is not exported

- [ ] **Step 3: Implement**

Replace `runProbe` in `probe.ts` with:

```ts
export interface ProbeOutcome {
  questionId: string;
  healed: boolean;
  slot?: number;
  text?: string;
  error?: string;
}

/**
 * One probe, as a VALUE (design 2026-09-08 §3.3). Carries the slot and text so
 * the terminal narrator needs no second read — today's in-loop send re-queries
 * the question purely to build its message.
 *
 * Throws only BudgetExhausted, exactly as resolveOne does.
 */
export async function probeOne(deps: PipelineDeps, questionId: string): Promise<ProbeOutcome> {
  try {
    const healed = await probeQuestion(deps, questionId);
    if (!healed) return { questionId, healed: false };
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
    return { questionId, healed: true, slot: q?.slot, text: q?.text };
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return { questionId, healed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Terminal narration — see narrateResolution for why it is its own step. */
export async function narrateProbe(
  deps: PipelineDeps,
  date: string,
  outcomes: ProbeOutcome[],
): Promise<void> {
  for (const o of outcomes.filter((x) => x.healed)) {
    await deps.telegram.send(
      `⚠ ${date} slot ${o.slot}: the answer exists, so the question closed early — "${o.text}"`,
    );
  }
  const failed = outcomes.filter((o) => o.error);
  if (failed.length > 0) {
    await deps.telegram.send(
      `⚠ probe failed (${date}): ${failed.map((f) => `${f.questionId}: ${f.error}`).join(" · ")}`,
    );
  }
}

/** The INLINE path — see runResolution. */
export async function runProbe(
  deps: PipelineDeps,
  date: string,
  questionIds: string[],
): Promise<ProbeOutcome[]> {
  const outcomes: ProbeOutcome[] = [];
  for (const questionId of questionIds) {
    outcomes.push(await probeOne(deps, questionId));
  }
  await narrateProbe(deps, date, outcomes);
  return outcomes;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. Any caller relying on `runProbe` returning a number must be updated to count outcomes.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/probe.ts test/pipeline-probe.test.ts
git commit -m "refactor(probe): one probe is a value, narration is terminal"
```

---

### Task 6: `ResolutionWorkflow` and `ProbeWorkflow` become multi-step

**Files:**
- Modify: `apps/api/src/pipeline/workflow-entrypoints.ts`

**Interfaces:**
- Consumes: `POLICY` (Task 3), `resolveOne` / `narrateResolution` (Task 4), `probeOne` / `narrateProbe` (Task 5), `NonRetryableError` (Task 1).
- Produces: `durableStep(step, name, policy, deps, fn)` — used by Task 9 for the gauntlet.

This is the task that closes spec §1.1 and §1.3.

- [ ] **Step 1: Add `durableStep` to `workflow-entrypoints.ts`**

```ts
import { WorkflowEntrypoint, NonRetryableError, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { POLICY, type StepPolicy } from "./steps";
import { BudgetExhausted, meterClaude, reportBudgetExhaustion } from "./spend";

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
async function durableStep<T>(
  step: WorkflowStep,
  name: string,
  policy: StepPolicy,
  deps: PipelineDeps,
  fn: () => Promise<T>,
): Promise<T> {
  return step.do(name, { timeout: policy.timeout, retries: policy.retries }, async () => {
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
```

- [ ] **Step 2: Rewrite `ResolutionWorkflow`**

```ts
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
```

- [ ] **Step 3: Rewrite `ProbeWorkflow`**

```ts
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
```

- [ ] **Step 4: Delete the now-dead `narrating()` helper**

`narrating()` existed to report budget exhaustion from inside the single big step. `durableStep` does that job for every step, so remove it and its uses.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. These classes are not exercised by the PGlite suite (the stub has no step engine); Task 14 tests them for real.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/workflow-entrypoints.ts
git commit -m "fix(workflows): one step per question, and a spent budget stops retrying"
```

---

# PHASE 2 — The gauntlet

Spec §3.1. The authoring workflow becomes nine steps plus an N-wide fan-out.

---

### Task 7: Split `gatherAuthoringContext` out of `generateCandidates`

**Files:**
- Modify: `apps/api/src/pipeline/gauntlet/generate.ts:95-119`
- Test: `apps/api/test/pipeline-author.test.ts` (or a new `test/gauntlet-generate.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export interface AuthoringContext { recent: string; signals: MarketSignal[]; scorecard: string; recentTopicKeys: string[] }
  export async function gatherAuthoringContext(deps: PipelineDeps, date: string): Promise<AuthoringContext>
  export async function generateCandidates(deps: PipelineDeps, date: string, ctx: AuthoringContext): Promise<unknown[]>
  ```
- `recentTopicKeys` is an ARRAY, not a `Set` — a step return must be structured-cloneable and a `Set` is not reliably so. Task 8 converts it back with `new Set(ctx.recentTopicKeys)`.

Why: the expensive model call must retry without re-fetching feeds, and the context must be checkpointed so a retry sees the same inputs.

- [ ] **Step 1: Write the failing test**

```ts
import { gatherAuthoringContext, generateCandidates } from "../src/pipeline/gauntlet/generate";

it("gathers context without calling the model", async () => {
  const { db } = await makeTestDb();
  let modelCalls = 0;
  const deps = makeDeps(db, { structured: async () => { modelCalls += 1; return { candidates: [] }; } });

  const ctx = await gatherAuthoringContext(deps, "2026-09-08");
  expect(modelCalls).toBe(0);
  expect(ctx.recent).toBeTypeOf("string");
  expect(Array.isArray(ctx.signals)).toBe(true);
  expect(Array.isArray(ctx.recentTopicKeys)).toBe(true);
});

it("generateCandidates takes the context rather than fetching it", async () => {
  const { db } = await makeTestDb();
  let fetched = 0;
  const deps = makeDeps(db, { structured: async () => ({ candidates: [] }) });
  deps.marketFetch = (async () => { fetched += 1; return new Response("[]"); }) as unknown as typeof fetch;

  const ctx = { recent: "none", signals: [], scorecard: "n/a", recentTopicKeys: [] };
  await generateCandidates(deps, "2026-09-08", ctx);
  // The feeds belong to the context step. Fetching here would mean a retry of
  // the model call re-fetches them.
  expect(fetched).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/gauntlet-generate.test.ts`
Expected: FAIL — `gatherAuthoringContext` is not exported

- [ ] **Step 3: Implement**

```ts
export interface AuthoringContext {
  recent: string;
  signals: MarketSignal[];
  scorecard: string;
  /**
   * An ARRAY, not a Set. This crosses a Workflow step boundary, and step
   * returns must be structured-cloneable; a Set is not reliably so. The
   * gauntlet rebuilds the Set on the far side.
   */
  recentTopicKeys: string[];
}

/**
 * Every input the author needs, and NO model call (design 2026-09-08 §3.1).
 *
 * Split out so the expensive generate step retries without re-fetching feeds,
 * and so the inputs are checkpointed: a retry must see the same context the
 * first attempt saw, or it is not a retry, it is a different question.
 */
export async function gatherAuthoringContext(deps: PipelineDeps, date: string): Promise<AuthoringContext> {
  const recent = await recentQuestionDigest(deps.db, date);
  // Market feeds stay advisory: any failure logs inside fetchMarketSignals and
  // authoring proceeds market-blind on an empty list.
  const { signals } = await fetchMarketSignals(deps.marketFetch ?? fetch, deps.now());
  const scorecard = qualityReport(questionQuality(await loadQualityRows(deps.db, date))).join("\n  ");
  const keys = await recentTopicKeys(deps.db, date);
  return { recent, signals, scorecard, recentTopicKeys: [...keys] };
}

export async function generateCandidates(
  deps: PipelineDeps,
  date: string,
  ctx: AuthoringContext,
): Promise<unknown[]> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  const response = await deps.claude.structured({
    model: deps.models.author,
    system: systemPrompt(date, ctx.recent, ctx.signals, ctx.scorecard),
    user: `Produce ${CANDIDATE_TARGET} candidate questions for ${date} now.`,
    schemaName: "candidate_round",
    schema: candidateSetJsonSchema,
    webSearch: { maxUses: 8 },
  });

  const list = (response as { candidates?: unknown }).candidates;
  // No retry loop here, unlike authorRound: the gauntlet's whole design is that
  // bad candidates are THROWN AWAY rather than corrected.
  return Array.isArray(list) ? list : [];
}
```

Add `import { recentTopicKeys } from "../candidate";` and re-export `AuthoringContext`.

- [ ] **Step 4: Update `runAuthoringGauntlet` to call both**

In `gauntlet/index.ts`, replace `const raw = await generateCandidates(deps, date);` with:

```ts
  const ctx = await gatherAuthoringContext(deps, date);
  const raw = await generateCandidates(deps, date, ctx);
```

and replace `recentTopicKeys: await recentTopicKeys(deps.db, date)` with `recentTopicKeys: new Set(ctx.recentTopicKeys)`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/gauntlet/generate.ts src/pipeline/gauntlet/index.ts test/gauntlet-generate.test.ts
git commit -m "refactor(gauntlet): context is gathered once and checkpointed, not re-fetched per retry"
```

---

### Task 8: Split `preflightOne` out of `preflight`

**Files:**
- Modify: `apps/api/src/pipeline/gauntlet/preflight.ts`
- Test: `apps/api/test/gauntlet-preflight.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PreflightOutcome = { index: number; passed: true } | { index: number; passed: false; rejection: Rejection }
  export async function preflightOne(deps: PipelineDeps, judged: Judged, index: number): Promise<PreflightOutcome>
  export async function preflight(deps: PipelineDeps, judged: Judged[]): Promise<{ passed: Judged[]; rejected: Rejection[] }>
  ```
- `preflightOne` carries the INDEX so the fan-out's results can be reassembled positionally after `Promise.all`, and so a step name and its result agree.
- Throws only `BudgetExhausted`, exactly as today.

- [ ] **Step 1: Write the failing test**

```ts
import { preflightOne } from "../src/pipeline/gauntlet/preflight";

it("preflightOne rejects a candidate whose answer already exists", async () => {
  const deps = makeDeps({ structured: async () => ({ outcome: "yes", quotes: ["it happened"], reasoning: "" }) });
  const j = { candidate: sampleCandidate(), criticProbability: 0.5 };
  const out = await preflightOne(deps, j, 3);
  expect(out.index).toBe(3);
  expect(out.passed).toBe(false);
  if (!out.passed) expect(out.rejection.reason).toBe("already-resolvable");
});

it("preflightOne passes an unverifiable candidate", async () => {
  const deps = makeDeps({ structured: async () => ({ outcome: "unverifiable", quotes: [], reasoning: "" }) });
  const out = await preflightOne(deps, { candidate: sampleCandidate(), criticProbability: 0.5 }, 0);
  expect(out.passed).toBe(true);
});

it("preflightOne turns a transient failure into an ambiguous rejection", async () => {
  const deps = makeDeps({ structured: async () => { throw new Error("503"); } });
  const out = await preflightOne(deps, { candidate: sampleCandidate(), criticProbability: 0.5 }, 1);
  expect(out.passed).toBe(false);
  if (!out.passed) expect(out.rejection.reason).toBe("ambiguous");
});

it("preflightOne still propagates a spent budget", async () => {
  const deps = makeDeps({ structured: async () => { throw new BudgetExhausted("2026-09-08", 151, true); } });
  await expect(
    preflightOne(deps, { candidate: sampleCandidate(), criticProbability: 0.5 }, 0),
  ).rejects.toBeInstanceOf(BudgetExhausted);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/gauntlet-preflight.test.ts`
Expected: FAIL — `preflightOne` is not exported

- [ ] **Step 3: Implement**

```ts
export type PreflightOutcome =
  | { index: number; passed: true }
  | { index: number; passed: false; rejection: Rejection };

/**
 * One candidate's pre-flight, as a VALUE carrying its own index.
 *
 * The index travels with the result because the fan-out reassembles
 * positionally after Promise.all, and because a step named `preflight-3` whose
 * result does not know it is 3 is a debugging trap.
 *
 * Throws only BudgetExhausted — a day-level stop, exactly as before.
 */
export async function preflightOne(
  deps: PipelineDeps,
  j: Judged,
  index: number,
): Promise<PreflightOutcome> {
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
    // "ambiguous" is already the critic's reason for the identical shape — a
    // model call this gate depends on came back unreadable, so there is no
    // verdict to judge.
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

/** The INLINE path — same parallelism as before, now over the shared unit. */
export async function preflight(
  deps: PipelineDeps,
  judged: Judged[],
): Promise<{ passed: Judged[]; rejected: Rejection[] }> {
  const outcomes = await Promise.all(judged.map((j, i) => preflightOne(deps, j, i)));
  return assemblePreflight(judged, outcomes);
}

/**
 * Reassembly, shared by the inline path and the Workflow fan-out so the two
 * cannot disagree about what a set of outcomes means.
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
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/gauntlet/preflight.ts test/gauntlet-preflight.test.ts
git commit -m "refactor(preflight): one candidate is a value that knows its index"
```

---

### Task 9: `AuthoringWorkflow` becomes nine steps plus a fan-out

**Files:**
- Modify: `apps/api/src/pipeline/workflow-entrypoints.ts`
- Modify: `apps/api/src/pipeline/gauntlet/index.ts` — export the pieces the workflow composes

**Interfaces:**
- Consumes: `gatherAuthoringContext`, `generateCandidates` (Task 7); `preflightOne`, `assemblePreflight` (Task 8); `durableStep`, `POLICY` (Tasks 3, 6).
- Produces: `commitRound(deps, date, written, tally, edited): Promise<GauntletResult>` and `narrateGauntlet(deps, date, result): Promise<void>`, both exported from `gauntlet/index.ts` and both used by the inline path too.

- [ ] **Step 1: Export the commit and narrate units from `gauntlet/index.ts`**

Extract from the tail of `runAuthoringGauntlet`:

```ts
/**
 * Selection plus both writes. Idempotent by construction: upsertDraft is an
 * upsert and the counter update sets fixed values, so a retry of this step
 * lands the same round twice with the same content.
 */
export async function commitRound(
  deps: PipelineDeps,
  date: string,
  written: number,
  tally: Record<RejectReason, number>,
  edited: Edited[],
): Promise<GauntletResult> {
  const rejected = Object.values(tally).reduce((a, b) => a + b, 0);
  const selection = selectRound(edited);
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
```

`runAuthoringGauntlet` keeps its behaviour by calling both at the end.

- [ ] **Step 2: Write `AuthoringWorkflow`**

```ts
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

    const raw = await durableStep(step, "generate", POLICY.model, deps, () =>
      generateCandidates(deps, date, ctx),
    );

    const opensAt = noonET(date);
    const locksAtDefault = noonET(addDays(date, 1));

    // Tier 0 — free.
    const tier0 = await durableStep(step, "screen", POLICY.pure, deps, async () =>
      screenCandidates(raw, {
        rulesVersion: 2,
        opensAt,
        locksAtDefault,
        recentTopicKeys: new Set(ctx.recentTopicKeys),
      }),
    );
    count(tier0.rejected);

    // Tier 1 — one GET each.
    const tier1 = await durableStep(step, "sources", POLICY.sourceFetch, deps, () =>
      checkSources(deps.sourceFetch ?? fetch, tier0.passed),
    );
    count(tier1.rejected);

    // Tier 2 — one model call, plus §7's contestedness gate.
    const tier2 = await durableStep(step, "critic", POLICY.model, deps, () =>
      criticize(deps, tier1.passed),
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
```

- [ ] **Step 3: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — `gauntlet-run.test.ts` exercises the inline path, which is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/workflow-entrypoints.ts src/pipeline/gauntlet/index.ts
git commit -m "feat(workflows): the gauntlet checkpoints every tier and fans out preflight"
```

---

# PHASE 3 — Usage capture (an instrument)

Spec §4.6. Gates nothing.

---

### Task 10: `pipeline_usage` table and `onUsage`

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: migration via `npx drizzle-kit generate`
- Create: `apps/api/src/pipeline/usage.ts`
- Modify: `apps/api/src/pipeline/claude.ts`, `apps/api/src/worker.ts`
- Test: `apps/api/test/pipeline-usage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CallUsage { model: string; inputTokens: number; outputTokens: number; webSearches: number }
  export async function recordUsage(db: Db, date: string, u: CallUsage): Promise<void>
  ```
- `makeClaudeClient(apiKey, fetchFn?, onUsage?: (u: CallUsage) => Promise<void>)` — third parameter, optional, so every existing call site keeps compiling.

**`ClaudeClient.structured` does NOT change.** Usage is reported through the constructor callback, which is what keeps the one-method interface — and therefore the ceiling's "applied in one place" claim — intact.

- [ ] **Step 1: Add the table to `schema.ts`**

```ts
// Usage telemetry (design 2026-09-08 §4.6). An INSTRUMENT, not a control:
// nothing reads this to decide anything. The ceiling stays a call count in
// pipeline_spend, because a price table inside a control path drifts silently
// and fails in both directions.
//
// Keyed by (date, model) rather than by call: the question it answers is "is
// the call-count proxy drifting?", and a per-call table would be a row per
// model call for a number nobody reads per call.
export const pipelineUsage = pgTable(
  "pipeline_usage",
  {
    date: date("date").notNull(),
    model: text("model").notNull(),
    calls: integer("calls").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.date, t.model] })],
);
```

Import `bigint`, `text`, `primaryKey` from `drizzle-orm/pg-core` as needed.

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new file in `apps/api/drizzle/`. Inspect it — it must be a pure `CREATE TABLE`, touching nothing else.

- [ ] **Step 3: Write the failing test**

Create `apps/api/test/pipeline-usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { recordUsage } from "../src/pipeline/usage";
import { makeClaudeClient } from "../src/pipeline/claude";

describe("recordUsage", () => {
  it("accumulates per (date, model) in one atomic statement", async () => {
    const { db } = await makeTestDb();
    await recordUsage(db, "2026-09-08", { model: "opus", inputTokens: 10, outputTokens: 5, webSearches: 1 });
    await recordUsage(db, "2026-09-08", { model: "opus", inputTokens: 3, outputTokens: 2, webSearches: 0 });
    await recordUsage(db, "2026-09-08", { model: "haiku", inputTokens: 1, outputTokens: 1, webSearches: 0 });

    const rows = await db.select().from(schema.pipelineUsage);
    const opus = rows.find((r) => r.model === "opus")!;
    expect(opus.calls).toBe(2);
    expect(opus.inputTokens).toBe(13);
    expect(opus.outputTokens).toBe(7);
    expect(opus.webSearches).toBe(1);
    expect(rows.find((r) => r.model === "haiku")!.calls).toBe(1);
  });
});

describe("makeClaudeClient onUsage", () => {
  it("reports usage without changing what structured() returns", async () => {
    const seen: unknown[] = [];
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", name: "s", input: { ok: true } }],
          usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 2 } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const client = makeClaudeClient("k", fakeFetch, async (u) => void seen.push(u));
    const out = await client.structured({ model: "m", system: "", user: "", schemaName: "s", schema: {} });

    // The return value is unchanged — this is what keeps ClaudeClient a
    // one-method interface and the ceiling's "one place" claim true.
    expect(out).toEqual({ ok: true });
    expect(seen).toEqual([{ model: "m", inputTokens: 100, outputTokens: 20, webSearches: 2 }]);
  });

  it("never lets a usage-recording failure break the model call", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "s", input: { ok: true } }] }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const client = makeClaudeClient("k", fakeFetch, async () => { throw new Error("db down"); });
    // An instrument must never take down the thing it measures.
    await expect(client.structured({ model: "m", system: "", user: "", schemaName: "s", schema: {} })).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run test/pipeline-usage.test.ts`
Expected: FAIL — cannot resolve `../src/pipeline/usage`

- [ ] **Step 5: Implement `usage.ts`**

```ts
// Usage telemetry (design 2026-09-08 §4.6). An INSTRUMENT.
//
// It answers one question — "is the call-count proxy drifting?" — and gates
// nothing. The ceiling stays a call count in spend.ts, deliberately: a price
// table inside a control path drifts silently whenever pricing changes and
// then fails either open (spending more than the operator believes) or closed
// (killing the drop for nothing).
import { sql } from "drizzle-orm";
import { schema, type Db } from "../db/client";

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}

/** One atomic upsert, for the same reason chargeCall is one: neon-http has no
 *  interactive transactions and two ticks can overlap. */
export async function recordUsage(db: Db, date: string, u: CallUsage): Promise<void> {
  await db
    .insert(schema.pipelineUsage)
    .values({
      date,
      model: u.model,
      calls: 1,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      webSearches: u.webSearches,
    })
    .onConflictDoUpdate({
      target: [schema.pipelineUsage.date, schema.pipelineUsage.model],
      set: {
        calls: sql`${schema.pipelineUsage.calls} + 1`,
        inputTokens: sql`${schema.pipelineUsage.inputTokens} + ${u.inputTokens}`,
        outputTokens: sql`${schema.pipelineUsage.outputTokens} + ${u.outputTokens}`,
        webSearches: sql`${schema.pipelineUsage.webSearches} + ${u.webSearches}`,
      },
    });
}
```

- [ ] **Step 6: Add `onUsage` to `claude.ts`**

Change the signature to `makeClaudeClient(apiKey: string, fetchFn: typeof fetch = fetch, onUsage?: (u: CallUsage) => Promise<void>)`.

After `const data = (await res.json()) as {...}` — widen the cast to include `usage` — add, before the `pause_turn` branch:

```ts
        if (onUsage) {
          const u = data.usage;
          try {
            await onUsage({
              model: call.model,
              inputTokens: u?.input_tokens ?? 0,
              outputTokens: u?.output_tokens ?? 0,
              webSearches: u?.server_tool_use?.web_search_requests ?? 0,
            });
          } catch {
            // An instrument must never take down the thing it measures. A
            // failed usage write loses a number; a thrown one loses the round.
          }
        }
```

Reported per HTTP response, so a `pause_turn` continuation contributes its own row — which is correct, since each continuation is separately billed.

- [ ] **Step 7: Wire it in `worker.ts`**

```ts
    claude: env.ANTHROPIC_API_KEY
      ? makeClaudeClient(env.ANTHROPIC_API_KEY, fetch, (u) => recordUsage(db, etNow(new Date()).date, u))
      : null,
```

Hoist `const db = makeDb(env.DATABASE_URL);` above the returned object so both `db:` and the callback use the same instance. Import `recordUsage` and `etNow`.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts drizzle/ src/pipeline/usage.ts src/pipeline/claude.ts src/worker.ts test/pipeline-usage.test.ts
git commit -m "feat(pipeline): record token usage as an instrument, never as a control"
```

---

# PHASE 4 — Observability

Spec §6.

---

### Task 11: Admin routes over `status()` and `restart()`

**Files:**
- Modify: `apps/api/src/routes/admin.ts`, `apps/api/src/app.ts`, `apps/api/src/worker.ts`, `apps/api/src/pipeline/workflows.ts`
- Test: `apps/api/test/admin-workflows.test.ts`

**Interfaces:**
- Extends `WorkflowBinding` in `workflows.ts`:
  ```ts
  export interface WorkflowInstanceHandle {
    status(): Promise<unknown>;
    restart(options?: { from?: { name: string; count?: number; type?: "do" | "sleep" | "waitForEvent" } }): Promise<void>;
  }
  export interface WorkflowBinding {
    create(options: { id: string; params: { date: string; questionIds?: string[] } }): Promise<unknown>;
    get(id: string): Promise<WorkflowInstanceHandle>;
  }
  ```
  Declared structurally, as the file's header already requires, so tests pass plain objects.

- [ ] **Step 1: Write the failing test**

```ts
it("GET /admin/workflows/:kind/:id returns the instance status", async () => {
  const app = makeApp({
    AUTHORING_WORKFLOW: { create: async () => {}, get: async () => ({ status: async () => ({ status: "complete" }), restart: async () => {} }) },
  });
  const res = await app.request("/admin/workflows/author/author-2026-09-08-2026090817", { headers: { "x-admin-secret": "s" } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "complete" });
});

it("refuses an unknown kind rather than guessing a binding", async () => {
  const app = makeApp({});
  const res = await app.request("/admin/workflows/nonsense/x", { headers: { "x-admin-secret": "s" } });
  expect(res.status).toBe(400);
});

it("requires the admin secret", async () => {
  const app = makeApp({});
  const res = await app.request("/admin/workflows/author/x");
  expect(res.status).toBe(401);
});

it("POST .../restart resumes from a named step", async () => {
  let restartedFrom: unknown;
  const app = makeApp({
    RESOLUTION_WORKFLOW: {
      create: async () => {},
      get: async () => ({ status: async () => ({}), restart: async (o: unknown) => void (restartedFrom = o) }),
    },
  });
  const res = await app.request("/admin/workflows/resolve/resolve-2026-09-07-2026090812/restart", {
    method: "POST",
    headers: { "x-admin-secret": "s", "content-type": "application/json" },
    body: JSON.stringify({ from: "resolve-q4" }),
  });
  expect(res.status).toBe(200);
  expect(restartedFrom).toEqual({ from: { name: "resolve-q4" } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/admin-workflows.test.ts`
Expected: FAIL — 404 on every route

- [ ] **Step 3: Implement the routes**

In `routes/admin.ts`, following the file's existing auth pattern:

```ts
const KINDS = { author: "AUTHORING_WORKFLOW", resolve: "RESOLUTION_WORKFLOW", probe: "PROBE_WORKFLOW" } as const;

// The operational lever this whole design exists to make possible: a
// resolution that died on question four is resumed AT question four, with the
// first three steps served from cache (design 2026-09-08 §6).
admin.get("/workflows/:kind/:id", async (c) => {
  const binding = bindingFor(c, c.req.param("kind"));
  if (!binding) return c.json({ error: "unknown workflow kind" }, 400);
  const instance = await binding.get(c.req.param("id"));
  return c.json(await instance.status());
});

admin.post("/workflows/:kind/:id/restart", async (c) => {
  const binding = bindingFor(c, c.req.param("kind"));
  if (!binding) return c.json({ error: "unknown workflow kind" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const from = typeof body.from === "string" ? { from: { name: body.from } } : undefined;
  const instance = await binding.get(c.req.param("id"));
  await instance.restart(from);
  return c.json({ ok: true });
});
```

`bindingFor` reads the workflow bindings off the app's env. Thread them through `createApp` alongside `pipeline`, mirroring how `pipeline` is already passed in `worker.ts`.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts src/app.ts src/worker.ts src/pipeline/workflows.ts test/admin-workflows.test.ts
git commit -m "feat(admin): read a workflow's status, and restart it from a named step"
```

---

# PHASE 5 — workerd step-semantics tests

Spec §7.2. This suite exists to test the four things §1 got wrong, which the PGlite suite structurally cannot see.

---

### Task 12: A second vitest project against workerd

**Files:**
- Create: `apps/api/vitest.workflows.config.ts`, `apps/api/test/workflows/steps.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: everything from Phases 1–2.
- Adds script: `"test:workflows": "vitest run -c vitest.workflows.config.ts"`. `pnpm test` stays the PGlite suite so the main gate never depends on workerd.

- [ ] **Step 1: Verify the package name before installing**

Cloudflare's docs name this API under both `@cloudflare/vitest-pool-workers` (≥0.9.0) and `@cloudflare/vitest-plugin` (≥1.0.0). Do not guess.

Run: `npm view @cloudflare/vitest-plugin version && npm view @cloudflare/vitest-pool-workers version`

Install whichever publishes `introspectWorkflow` from `cloudflare:test`, as a dev dependency, and record which one in the config's header comment.

- [ ] **Step 2: Write the config**

```ts
// A SECOND vitest project, deliberately separate (design 2026-09-08 §7.2).
//
// The PGlite suite must never be dragged into workerd: it uses node:fs to read
// drizzle migrations, and it is the regression net for everything else. This
// project tests ONLY step semantics — the things a stubbed `cloudflare:workers`
// structurally cannot show.
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/workflows/**/*.test.ts"],
    poolOptions: { workers: { wrangler: { configPath: "./wrangler.jsonc" } } },
  },
});
```

- [ ] **Step 3: Write the tests**

```ts
import { env } from "cloudflare:test";
import { introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("resolution workflow step semantics", () => {
  it("gives each question its own step, so no step spans five resolves", async () => {
    // Defect §1.1: one step wrapping a sequential loop over five questions sat
    // on the inherited 10-minute timeout.
    await using instance = await introspectWorkflowInstance(env.RESOLUTION_WORKFLOW, "t-1");
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepResult({ name: "resolve-q1" }, { questionId: "q1", resolved: true });
      await m.mockStepResult({ name: "resolve-q2" }, { questionId: "q2", resolved: true });
    });
    await env.RESOLUTION_WORKFLOW.create({ id: "t-1", params: { date: "2026-09-08", questionIds: ["q1", "q2"] } });
    await expect(instance.waitForStatus("complete")).resolves.not.toThrow();
  });

  it("does NOT retry a resolve step — the hourly cron is that retry layer", async () => {
    // Spec §4.1. A retry here would multiply against the outer loop.
    await using instance = await introspectWorkflowInstance(env.RESOLUTION_WORKFLOW, "t-2");
    let attempts = 0;
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "resolve-q1" }, new Error("boom"), 99);
    });
    await env.RESOLUTION_WORKFLOW.create({ id: "t-2", params: { date: "2026-09-08", questionIds: ["q1"] } });
    await instance.waitForStatus("errored");
    // resolveOne captures ordinary errors, so reaching `errored` at all means
    // the step engine surfaced it — and it must have done so on attempt one.
    expect(attempts).toBeLessThanOrEqual(1);
  });

  it("stops the instance dead on a spent budget instead of retrying it five times", async () => {
    // Defect §1.3: the meter charges BEFORE each call, so five retries of an
    // already-crossed ceiling charge five more times for zero work.
    await using instance = await introspectWorkflowInstance(env.AUTHORING_WORKFLOW, "t-3");
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: "generate" }, new Error("pipeline: daily call budget exhausted"), 99);
    });
    await env.AUTHORING_WORKFLOW.create({ id: "t-3", params: { date: "2026-09-08" } });
    await instance.waitForStatus("errored");
    const err = await instance.getError();
    expect(err.name).toBe("BudgetExhausted");
  });
});
```

Adapt assertions to the introspector's exact return shapes as encountered — the API surface is documented at `developers.cloudflare.com/workers/testing/vitest-integration/test-apis/`.

- [ ] **Step 4: Run**

Run: `npx vitest run -c vitest.workflows.config.ts`
Expected: PASS.

**Known risk, from the spec:** `cloudflare/workers-sdk#10600` reports Workflows tests running unreliably in CI under this pool. If it proves flaky, keep this suite out of the merge gate and run it locally — it is a correctness instrument, not a gate. Record what you observe in the commit message.

- [ ] **Step 5: Commit**

```bash
git add vitest.workflows.config.ts test/workflows/ package.json
git commit -m "test(workflows): pin step timeouts, retry limits and the budget stop against workerd"
```

---

# PHASE 6 — Gate evals

Spec §8. Split by whether a gate can be frozen: web search happens server-side at Anthropic and cannot be recorded or replayed, and that fact determines how each gate is measured.

---

### Task 13: Hermetic evals for `critic` and `taste`

**Files:**
- Create: `apps/api/eval/fixtures/critic.json`, `apps/api/eval/fixtures/taste.json`, `apps/api/eval/score.ts`, `apps/api/eval/critic.eval.ts`, `apps/api/eval/taste.eval.ts`
- Test: `apps/api/test/eval-score.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Confusion { truePass: number; trueReject: number; falsePass: number; falseReject: number }
  export function score(cases: { expected: "pass" | "reject"; actual: "pass" | "reject" }[]): Confusion
  export function formatConfusion(gate: string, c: Confusion): string
  ```

Both gates run WITHOUT web search (`taste.ts` says so explicitly; `models.critic` is documented "Opus 5, no search"), which is exactly why they can be scored against fixtures at all.

- [ ] **Step 1: Write the failing test for the scorer**

```ts
import { describe, expect, it } from "vitest";
import { score, formatConfusion } from "../eval/score";

describe("score", () => {
  it("counts the two error kinds separately", () => {
    const c = score([
      { expected: "pass", actual: "pass" },
      { expected: "reject", actual: "reject" },
      { expected: "reject", actual: "pass" },
      { expected: "pass", actual: "reject" },
    ]);
    expect(c).toEqual({ truePass: 1, trueReject: 1, falsePass: 1, falseReject: 1 });
  });

  it("reports false passes first, because they are the expensive error", () => {
    // A false ACCEPT on taste is a brand and App Review incident. A false
    // REJECT is free — surplus absorbs it. A single accuracy number over a
    // gate this asymmetric would hide the only error that matters.
    const out = formatConfusion("taste", { truePass: 8, trueReject: 4, falsePass: 2, falseReject: 1 });
    expect(out.indexOf("false-pass")).toBeLessThan(out.indexOf("false-reject"));
    expect(out).toContain("2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/eval-score.test.ts`
Expected: FAIL — cannot resolve `../eval/score`

- [ ] **Step 3: Implement `score.ts`**

```ts
// Gate scoring (design 2026-09-08 §8.1).
//
// ASYMMETRIC ON PURPOSE. These gates do not have one error rate, they have
// two, and the two cost wildly different amounts:
//
//   false PASS on taste     → a tasteless question reaches every player.
//   false REJECT on taste   → one candidate thrown away, absorbed by surplus.
//
// Reporting a single accuracy number over a gate this asymmetric would hide
// the only error anybody cares about, which is why there is no accuracy number
// in this file.
export interface Confusion { truePass: number; trueReject: number; falsePass: number; falseReject: number }

export function score(cases: { expected: "pass" | "reject"; actual: "pass" | "reject" }[]): Confusion {
  const c: Confusion = { truePass: 0, trueReject: 0, falsePass: 0, falseReject: 0 };
  for (const k of cases) {
    if (k.expected === "pass" && k.actual === "pass") c.truePass += 1;
    else if (k.expected === "reject" && k.actual === "reject") c.trueReject += 1;
    else if (k.expected === "reject" && k.actual === "pass") c.falsePass += 1;
    else c.falseReject += 1;
  }
  return c;
}

/** False passes lead, because they are the error that costs something. */
export function formatConfusion(gate: string, c: Confusion): string {
  const n = c.truePass + c.trueReject + c.falsePass + c.falseReject;
  return [
    `${gate.toUpperCase()} — ${n} cases`,
    `  false-pass   ${c.falsePass}   ← the expensive error`,
    `  false-reject ${c.falseReject}   (absorbed by surplus)`,
    `  correct      ${c.truePass + c.trueReject}`,
  ].join("\n");
}
```

- [ ] **Step 4: Write the fixtures**

`eval/fixtures/taste.json` — at least 12 cases, each `{ "text": "...", "expected": "pass" | "reject" }`. Draw the reject cases from the forbidden list in `taste.ts`'s SYSTEM prompt: deaths, disasters or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or rewarding hope of harm. Draw the pass cases from the stated-acceptable set: public figures' professional outcomes, and ordinary markets, sports, weather and culture questions. Include at least two DELIBERATELY NEAR the line — a public figure's resignation (pass) and a named person's health (reject) — because a fixture set with no hard cases measures nothing.

`eval/fixtures/critic.json` — at least 10 cases, each `{ "text": "...", "resolution_criteria": "...", "expected": "pass" | "reject" }`. Reject cases must include a compound question joined by "and", one whose criteria do not determine the outcome, and one readable two ways.

- [ ] **Step 5: Write the two eval runners**

Each loads its fixtures, builds a real `PipelineDeps` with a real `makeClaudeClient` from `ANTHROPIC_API_KEY`, calls the gate once over the whole fixture batch (both gates are batch gates), maps verdicts to `"pass" | "reject"`, and prints `formatConfusion`. Exit non-zero if `falsePass > 0` on taste — that is the error the gate exists to prevent.

- [ ] **Step 6: Commit**

```bash
git add eval/ test/eval-score.test.ts
git commit -m "feat(eval): score the two hermetic gates on asymmetric confusion"
```

---

### Task 14: Retrospective resolver eval and the `pnpm eval` entry point

**Files:**
- Create: `apps/api/eval/resolver.eval.ts`, `apps/api/eval/run.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Adds script: `"eval": "tsx eval/run.ts"` (or `node --experimental-strip-types`, matching whatever the repo already uses for scripts). Deliberately NOT part of `pnpm test` — it costs money and touches the network, and the suite's rule that no test hits the network stays intact.

The resolver is the highest-stakes call in the system and the one with free labelled data: `questions.resolutionEvidence` already stores both verdicts and the disagreement flag (`resolve.ts:31-38`), and nothing reads it.

- [ ] **Step 1: Write `resolver.eval.ts`**

Two numbers, both read from production history rather than from fixtures:

1. **Disagreement rate** — over settled questions in a window, the share whose stored evidence carries `disagreement: true`. Already collected; needs only to be read.
2. **Re-resolution agreement** — re-run `askResolver` against a sample of already-settled questions and compare to the recorded outcome. This one costs money, so it takes a `--sample N` flag defaulting to 10.

Print both, and state plainly in the output that a settled question's source may have changed since — this measures agreement with the record, not with the truth as of the round.

- [ ] **Step 2: Write `run.ts`**

Dispatch on `process.argv[2]`: `critic`, `taste`, `resolver`, or `all`. Require `ANTHROPIC_API_KEY` and, for the resolver, `DATABASE_URL`; fail with a clear message naming the missing variable rather than a stack trace.

Print, before running anything, an estimate of how many model calls the selected evals will make — this harness is the one thing in the repo that spends money outside the daily ceiling, and it should say so before it does.

- [ ] **Step 3: Add a `preflight` note to the harness output**

Print, when `all` is selected, the sentence from spec §8.3: preflight is measured by the leak tripwire in `leak.ts`, not here, because "was this answerable on date X" cannot be re-run after the fact and a fixture set would look like measurement without being any.

- [ ] **Step 4: Verify it runs without a key**

Run: `pnpm eval taste`
Expected: a clear "ANTHROPIC_API_KEY is not set" message and a non-zero exit — NOT a stack trace, and no network call.

- [ ] **Step 5: Commit**

```bash
git add eval/ package.json
git commit -m "feat(eval): score the resolver against the record it already keeps"
```

---

## Final verification

- [ ] `npx vitest run` — full PGlite suite green
- [ ] `npx tsc --noEmit` and `npx tsc --noEmit -p test/tsconfig.json`
- [ ] `npx vitest run -c vitest.workflows.config.ts` — step semantics green (or documented flaky per Task 12)
- [ ] `pnpm eval taste` fails cleanly without a key
- [ ] `npx wrangler deploy --dry-run` — the Worker still builds with all three Workflow classes exported

## Self-review notes

Spec coverage checked section by section: §1.1→Tasks 3/6, §1.2→Tasks 6/9, §1.3→Tasks 1/6, §1.4→Task 2, §2.1→unchanged by design, §3.1→Tasks 7/8/9, §3.2→Task 6, §3.3→Tasks 5/6, §4.1→Task 3, §4.2→Task 3, §4.3→Task 6, §4.4→Task 2, §4.5→no code (the ceiling is unchanged; the derivation is the deliverable), §4.6→Task 10, §5.1→Tasks 2/3/9, §5.2→Tasks 4/5/9, §5.3→Task 9, §6→Task 11, §7.1→preserved by every task, §7.2→Task 12, §8.1→Task 13, §8.2→Task 14, §8.3→Task 14 step 3, §8.4→Task 14, §9→no code by definition, §10→phase ordering.
