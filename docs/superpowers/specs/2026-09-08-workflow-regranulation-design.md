# Workflow Re-granulation — Design

**Date:** 2026-09-08
**Status:** proposed
**Supersedes nothing.** Extends design 2026-09-04 §2 (the execution substrate).

---

## 1. The problem, stated precisely

Cloudflare Workflows are already adopted. Three classes exist in
`src/pipeline/workflow-entrypoints.ts`, bound in `wrangler.jsonc`, dispatched
from `runTick` through `bindingStarter`, with `inlineStarter` as the dev and
test fallback. The architecture design 2026-09-04 §2 asked for — cron DECIDES,
a Workflow EXECUTES, `decideActions` stays pure — is in place.

What is missing is GRANULARITY. Each workflow is a single `step.do()` wrapping
its entire body:

```ts
// workflow-entrypoints.ts:53
await step.do("gauntlet", async () => { ... runAuthoringGauntlet ... })
```

A workflow with one step is a workflow with no checkpoints. None of the
properties the substrate was adopted for — targeted retry, resumability,
per-stage observability — are realised. Three defects follow directly, and one
more was found while specifying the fix.

### 1.1 The 10-minute step timeout re-creates the cap it replaced

`WorkflowStepConfig` defaults to `timeout: "10 minutes"`. The comment at
`workflows.ts:14` — "unlimited wall-clock per step" — is true of the INSTANCE,
not of a step.

`runResolution` (`resolve.ts:92`) is a SEQUENTIAL loop over up to five
questions, each awaiting a `Promise.all` of two web-search resolvers that
`resolve.ts:80` states "can take minutes across chained web searches". Five
questions at two-to-four minutes each is ten to twenty minutes inside a
ten-minute step.

This has not bitten for exactly the reason the original cron cap never bit: the
pipeline has never run an unattended day.

### 1.2 Retries replay the whole body

The default is `retries: { limit: 5, delay: 10s, backoff: "exponential" }`.

A gauntlet that fails on the taste call — roughly fifteen model calls in —
re-runs generate, critic and twelve preflights on every attempt. Six attempts is
approaching a hundred model calls against a daily ceiling of 150
(`spend.ts:26`), spent on a single bad night.

Non-idempotent side effects replay with them. `narrate()` (`gauntlet/index.ts:118`)
sends a Telegram message per attempt.

### 1.3 `BudgetExhausted` is retryable when it must not be

`narrating()` (`workflow-entrypoints.ts:44`) rethrows `BudgetExhausted`
deliberately, so the step records the failure. Cloudflare then retries it five
times, and `meterClaude` charges BEFORE each call (`spend.ts:69`). Every retry
pushes the counter further past a ceiling that has already been crossed, for
zero work performed.

The `first` flag keeps every one of those retries silent. This is silent budget
burn, which is worse than noisy budget burn.

### 1.4 (Found while specifying) The taste gate swallows `BudgetExhausted`

`tasteCheck` catches EVERY error and converts it to `rejectAll`
(`taste.ts:83`). `preflight.ts:58` explicitly re-throws `BudgetExhausted`
because a spent budget is a day-level stop; taste does not.

The consequence: when exhaustion lands on the taste call, taste rejects the
batch, `assessEditorial` returns early on the empty list, selection fails, and
the night ends with a "0 published" narration. The day stops — but
`reportBudgetExhaustion` never sees the error, so the budget's ONE critical
line never fires. The operator learns nothing.

---

## 2. Three layers, named

The design holds together because the layers stay separable.

| Layer | Owns | Where it lives | Changing? |
|---|---|---|---|
| **Decision** | Cadence | `decideActions`, pure over (ETNow, PipelineState) | No |
| **Durability** | Checkpointing, retry, cost envelope | Workflow instances and steps | **Yes — this is the work** |
| **Judgement** | What is true | The runners and gates | Mostly no |

`decideActions` DOES NOT CHANGE ITS NATURE, for the reason `workflows.ts:26-31`
already gives: purity is what makes every action idempotent, replayable and
testable, and it is a better property for DECIDING than durable execution is.

### 2.1 The two-tier checkpoint invariant

**The DB is the cross-hour checkpoint. Workflow steps are the within-hour
checkpoint.**

This is deliberate, and half of it already exists: `decideActions` passes only
`unresolvedIds`, and `resolveWithClaude` re-checks `status === "locked"` before
writing, so a new hourly instance never redoes settled work. Steps add the
missing tier — progress WITHIN an hour now survives a failure instead of being
discarded.

Stating both tiers is what keeps the retry layers from multiplying (§4).

---

## 3. Step topology

### 3.1 AuthoringWorkflow

Nine fixed steps and an N-wide fan-out.

| Step | Cost | `retries.limit` | Notes |
|---|---|---|---|
| `context` | DB + feeds | 3 | Split out of `generateCandidates` |
| `generate` | 1 model | 2 | |
| `screen` | free | 3 | Tier 0; makes the tally durable |
| `sources` | N × HTTP | 2 | Already `Promise.all` |
| `critic` | 1 model | 2 | Includes the §7 contestedness gate |
| `preflight-<i>` | 1 model each | 1 | Fan-out via `Promise.all` |
| `taste` | 1 model | **0** | Fail-closed — see §5.1 |
| `editorial` | 1 model | 2 | |
| `commit` | DB | 3 | `upsertDraft` + counters; already idempotent |
| `narrate` | Telegram | 3 | TERMINAL, so no retry re-narrates |

**Required refactor.** `generateCandidates` currently bundles its own I/O
(`fetchMarketSignals`, `loadQualityRows`, `recentQuestionDigest`) with the model
call. Split into `gatherAuthoringContext(deps, date)` and
`generateCandidates(deps, date, ctx)` so the expensive model call retries
without re-fetching feeds, and so the context is checkpointed.

`recentTopicKeys` moves into `context` as well, since `screen` consumes it.

**Fan-out naming.** Steps are named `preflight-${index}` over the checkpointed
`screen` output.

Index, NOT `topic_key` — though not because topic keys collide. They do not:
`screenCandidates` seeds its `seen` set with `recentTopicKeys` and drops any
repeat WITHIN the batch too, first occurrence winning (`candidate.ts:83-84`), so
every survivor's key is already unique. The reason is coupling. A step name is
a durable cache key; deriving it from a value that is unique only because a
DIFFERENT function currently chooses to dedupe it makes step identity depend on
an invariant nobody declared and no test guards. Position is unique by
construction. The topic key travels in the step's RETURN value, where it serves
debugging without serving as identity.

Determinism holds because `screen`'s output is checkpointed and traversed in
order — the condition the Rules of Workflows require for dynamic step names.

**Step count.** Nine plus roughly twelve, against a limit of 10,000.

### 3.2 ResolutionWorkflow

One step per question, `resolve-<questionId>`, **SEQUENTIAL**.

Sequential is sufficient: each step carries its own timeout budget, which is
what removes §1.1 entirely. Parallelising would additionally cut wall-clock,
but it would take peak concurrency against the Anthropic API from two (the two
resolvers inside one question, already parallel at `resolve.ts:65`) to ten.
That is a separate decision about rate-limit exposure and is deliberately NOT
bundled here.

Terminal `narrate` step for the failure summary.

### 3.3 ProbeWorkflow

One step per question, `probe-<questionId>`. One model call each.

Probe narration currently fires per healed question inside the loop
(`probe.ts:66`). It moves to a terminal `narrate` step fed by the steps' return
values.

---

## 4. Retry, and the ceiling re-derived

### 4.1 Cron outer, steps shallow

Two retry layers now exist: hourly cron re-dispatch, and per-step Workflow
retry. They must ADD, never MULTIPLY.

**Resolve and probe model steps take `retries: { limit: 0 }`.** The hourly cron
re-dispatch IS their retry layer; `decideActions` already re-fires them every
hour until the void deadline, and it already passes only the questions still
outstanding. An inner retry would be pure multiplication against an outer loop
that is already correct.

**The gauntlet keeps shallow inner retries, for a cost reason rather than a
cadence reason.** Its outer loop is not thin — it re-fires hourly from 17:00 —
but an outer re-fire lands on a NEW hour bucket, therefore a new instance id,
therefore no checkpoint reuse: the whole gauntlet re-runs from `context` at a
cost of roughly fifteen model calls. An inner retry on the one step that failed
costs one. For the gauntlet the inner retry is strictly cheaper than the outer
one, so it is worth having.

Resolution is the mirror image: its outer loop is already scoped per question by
the DB (`decideActions` passes only `unresolvedIds`), so an outer re-fire costs
nothing for work already done, and an inner retry buys nothing an outer one does
not. Hence `limit: 0` there and shallow-but-nonzero here.

### 4.2 Explicit timeouts

Every step declares a `timeout` sized to its tier, all well under the
ten-minute default. The default is never inherited: an inherited timeout is the
defect in §1.1, and a step whose timeout is not stated is a step whose duration
nobody has thought about.

### 4.3 `BudgetExhausted` becomes non-retryable

`BudgetExhausted` stays a plain `Error` in `spend.ts` — that file is pure
TypeScript imported by tests that never load workerd, and it must stay that
way.

The mapping to `NonRetryableError` happens in a new `durableStep()` helper in
`workflow-entrypoints.ts`, which is ALREADY the only file in the pipeline that
imports `cloudflare:workers` (see its header). `durableStep()` wraps `step.do`
with three responsibilities:

1. Explicit `timeout` and `retries` config — no inherited defaults.
2. `BudgetExhausted` → narrate once, then rethrow as `NonRetryableError`.
3. Return a small serialisable summary for §6.

### 4.4 The taste gate must let `BudgetExhausted` through

Fixes §1.4. `tasteCheck`'s catch re-throws `BudgetExhausted` before falling
through to `rejectAll`, exactly as `preflight.ts:58` already does. Every other
error still fails closed.

This is a one-line change and it restores the budget's single critical alert on
the one path where it was being swallowed.

### 4.5 The ceiling stays a CALL count

**Decision: the ceiling is not converted to dollars.**

A price table inside a control path is a liability. It drifts silently whenever
Anthropic changes pricing, and a wrong table either fails open — spending more
than the operator believes — or fails closed, killing the drop for no reason.

A call count is a sound proxy HERE specifically because the model for each gate
is pinned in env vars (`worker.ts:63-75`); no gate selects a model dynamically,
so cost per call is stable per gate.

And precision was never the defect. The defect was retry TOPOLOGY. The fix is to
re-derive the number against the new topology, not to make the unit finer.

**Re-derivation.** Nominal night, unchanged from `spend.ts:22`: ~52 calls.
Worst case under the limits in §3.1:

| Source | Worst case |
|---|---|
| `generate` | 1 × 3 = 3 |
| `critic` | 1 × 3 = 3 |
| `preflight` | 12 × 2 = 24 |
| `taste` | 1 × 1 = 1 |
| `editorial` | 1 × 3 = 3 |
| Gauntlet subtotal, per firing | 34 |
| Resolution, per hourly firing | 5 × 2 × 1 = 10 |
| Probe, per 4-hourly firing | ~5 × 1 = 5 |

The pathological case remains an all-night resolution retry, and it is larger
than it first appears. The grace window is noon D+1 → noon D+2 — TWENTY-FOUR
hours, one firing per hour at `minute < 10`, plus all six ticks during hour 12
(`state.ts:179`). Five questions unresolved across the whole window is roughly
29 firings at ten calls each: ~290 calls, before the gauntlet's 34.

That blows 150, and it SHOULD. The breaker halts the day after roughly fifteen
hours of a storm that has already failed fifteen hours running; the questions
void at noon D+2 regardless; and the bank covers the drop. The final ~9 hours of
retries not happening is the correct outcome, not a lost opportunity.

**The ceiling stays 150.** It was re-derived against the new topology and found
still correct — which is the outcome worth recording, and the reason to write
the derivation down rather than adjust the number by feel.

### 4.6 Usage capture — an instrument, not a control

`claude.ts:79` receives `usage` on every response and discards it. The metering
wrapper gains an `onUsage` callback that records tokens and model per call into
`pipeline_spend`.

`ClaudeClient.structured`'s SIGNATURE DOES NOT CHANGE. Widening it would touch
every gate, and — more importantly — the one-method interface is precisely why
`spend.ts:11` can honestly claim "THE CEILING, APPLIED IN ONE PLACE". That
claim is the most load-bearing property in the pipeline and nothing in this
design may weaken it.

This is an instrument. It answers "is the call-count proxy drifting?" and it is
the natural event shape for PostHog later (§8). It does not gate anything.

---

## 5. Behaviour changes, stated rather than discovered

### 5.1 Taste stays fail-closed, EXACTLY

`tasteCheck` catches its errors internally and returns `rejectAll` rather than
throwing (`taste.ts:83`), so wrapping it in a step would not introduce a retry
by itself. `retries: { limit: 0 }` is set anyway, so that the guarantee is
declared rather than emergent, and so no future edit can reintroduce a retry by
accident.

A transient 429 on the taste call therefore still rejects the night, exactly as
today. The cost is a fall-through to the evergreen bank, a mechanism that
already exists and is already tested. The alternative — retrying a gate whose
entire purpose is to fail closed — was considered and rejected.

### 5.2 Narration becomes effectively once

Terminal `narrate` steps mean an earlier step's retry can no longer re-send a
Telegram message. Today it can.

### 5.3 Partial progress survives

A taste failure stops discarding fifteen model calls' worth of work. This is
the whole point.

---

## 6. Observability

Each step returns a small serialisable summary — counts, durations, model, and
the tier's rejection tally. The workflow returns the aggregate, which surfaces
through `instance.status()`.

Two admin routes, guarded by the existing `x-admin-secret`:

- `GET /admin/workflows/:kind/:id` → `instance.status()`
- `POST /admin/workflows/:kind/:id/restart` → `instance.restart({ from })`

`restart({ from })` is the operational lever this design exists to make
possible: a resolution that died on question four can be resumed at question
four, with the first three steps served from cache.

---

## 7. Testing — two tiers, neither replacing the other

### 7.1 The existing PGlite suite is unchanged

Every runner stays an ordinary async function over `PipelineDeps`.
`inlineStarter` keeps working, and every existing tick, gauntlet, resolve and
probe test keeps asserting the same outcomes. This remains the regression net,
and it must not regress.

### 7.2 A new workerd suite for step semantics only

Cloudflare's vitest integration ships a Workflows introspection API. Its purpose
here is narrow: to test the things §1 got wrong, which the PGlite suite
structurally cannot see.

**Verify the package name at install time.** Cloudflare's docs refer to this API
under both `@cloudflare/vitest-pool-workers` (≥0.9.0) and
`@cloudflare/vitest-plugin` (≥1.0.0); the latter appears to be a rename. Do not
take either on faith from this document — check what actually publishes the
`introspectWorkflow` export before pinning.

| Assertion | API |
|---|---|
| Retry limits hold per step | `mockStepError(step, err, times)` |
| Timeouts are configured, not inherited | `forceStepTimeout(step)` |
| `BudgetExhausted` halts the instance with no further steps | `mockStepError` + `waitForStatus("errored")` |
| Fan-out names are deterministic across replays | `waitForStepResult({ name, index })` |
| Suite runs fast | `disableRetryDelays()` |

Configured as a SEPARATE vitest project so the PGlite suite is never dragged
into workerd. Introspectors are disposed per test via `await using` — Workflows
uses per-file storage isolation and a leaked introspector cross-contaminates.

**Known risk:** `vitest-pool-workers` has an open reliability issue running
Workflows tests in CI (`cloudflare/workers-sdk#10600`). If it proves flaky,
this suite runs locally and on demand rather than gating merges. It is a
correctness instrument, not a gate.

---

## 8. Gate evals

The gauntlet is a stack of judges and NOTHING MEASURES WHETHER THEY JUDGE WELL.
`quality.ts` measures outcomes — void rate, uncontested rate, author Brier —
which is a drift alarm on the author's standards, not a score for any gate.

The gates split cleanly on one axis: **web search happens server-side at
Anthropic and cannot be recorded or replayed.** That fact, not preference,
determines how each gate can be measured.

### 8.1 Hermetic — `critic` and `taste`

Both run WITHOUT web search (`models.critic` is "Opus 5, no search";
`models.taste` is Haiku, and `taste.ts` says "No webSearch. Classification, not
research."). They can therefore be scored against curated fixtures in
`test/fixtures/gates/`.

Scored on ASYMMETRIC confusion, because the gates are asymmetric:

- A false ACCEPT on taste is a brand and App Review incident.
- A false REJECT on taste is free — surplus absorbs it (`generate.ts:1-9`).

Reporting a single accuracy number over a gate this asymmetric would hide the
only error that matters.

### 8.2 Retrospective — the `resolver`

The highest-stakes call in the system, and the one with free labelled data:
`questions.resolutionEvidence` already stores BOTH verdicts and the
disagreement flag (`resolve.ts:31-38`). Nothing reads it.

Scored against settled questions from the app's own history. The dataset grows
on its own, needs no curation, and disagreement rate is an already-collected
reliability proxy sitting unused in production.

### 8.3 Tripwire, not eval — `preflight`

"Was this answerable on 2026-08-14?" cannot be re-run after the fact; the
answer certainly exists by the time any eval runs. A fixture set here would
measure nothing and would LOOK like it measured something, which is worse.

The honest instrument is the drift telemetry `leak.ts` already computes, read
with the caution its own header demands: "A quiet LEAK WATCH is not
vindication; it's the absence of a symptom that a real leak isn't guaranteed to
produce."

### 8.4 Mechanics

A `pnpm eval` script, deliberately NOT part of `pnpm test` — it costs money and
touches the network, and the test suite's rule that no test hits the network
stays intact.

**No `gate_evals` table in the first cut.** The script reports to stdout and
Telegram. A table earns its place only once the reports have proved worth
trending — the same discipline design 2026-09-04 §9.2 applied to rejection
counts, where counts beat a table at zero schema cost and promoting them later
stayed purely additive.

---

## 9. Explicitly out of scope

**Not adopting an agent framework.** Mastra's workflow engine competes with
Cloudflare Workflows rather than complementing it; eve wants to own a runtime
that is already a Cloudflare Worker serving the mobile app's API. Neither
solves the problem in §1 — step granularity around expensive non-idempotent
calls is identical in any engine. Porting it is not fixing it.

**Not adopting the Vercel AI SDK.** Its retry layer would be a THIRD layer
underneath the two §4.1 just deliberately flattened, invisible to the meter's
per-attempt accounting. And a wider client surface weakens the one-method
`ClaudeClient` seam that §4.6 protects.

**Not agentifying anything yet.** The layers in §2 are orthogonal: durable
execution is the envelope, and whatever runs INSIDE a step may become as
agentic as it likes. This work makes each judge an independently retryable,
independently budgeted, independently observable unit — which is exactly the
shape required to swap one of them for an agent later without touching the
other twenty. **The designated first seam is the resolver**: highest stakes,
and a crisp success criterion (does it match a careful human's reading of the
named source?) with labelled data already accumulating per §8.2.

**Not building analytics.** PostHog is worth doing and is its own workstream,
and it should LEAD WITH PRODUCT ANALYTICS rather than LLM cost — the app
currently has no analytics of any kind, and for a Shipaton entry, activation and
retention data is worth more than per-gate cost attribution. This design
produces the right event shape (§6) and stops there. Coupling an analytics
integration to a substrate refactor is how both slip.

---

## 10. Order of work

| Phase | Content | Independently shippable |
|---|---|---|
| 1 | Resolve/probe per-question steps; `NonRetryableError`; taste re-throw (§4.4); explicit configs | **Yes — this is the live-bug fix** |
| 2 | Gauntlet re-granulation + `generateCandidates` split | Yes |
| 3 | Usage capture (§4.6) | Yes |
| 4 | Observability + admin routes (§6) | Yes |
| 5 | workerd step-semantics suite (§7.2) | Yes |
| 6 | Gate evals (§8) | Yes |

Phase 1 addresses §1.1, §1.3 and §1.4 and is the only phase that fixes a defect
capable of breaking an unattended night. Everything after it is upside.

---

## 11. Constraints inherited from the codebase

- **No new runtime npm dependencies.** Cloudflare's vitest integration (§7.2) is
  a dev dependency; nothing new ships to the Worker.
- **`neon-http` has NO interactive transactions.** `chargeCall`'s single atomic
  upsert pattern (`spend.ts:44-47`) is the model for any new write.
- **No live network calls in the PGlite suite.** Every Claude, Telegram, feed
  and source fetch stays injectable.
- **`decideActions` stays pure** over `(ETNow, PipelineState)`.
- **`ClaudeClient` stays a one-method interface.**
- **ET time only** via `Intl.DateTimeFormat` with `America/New_York`.
- Run api commands from `apps/api/`. Full check: `npx vitest run` and
  `npx tsc --noEmit`.
