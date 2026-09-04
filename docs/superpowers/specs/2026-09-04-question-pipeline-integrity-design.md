# ORACLE — Question Pipeline Integrity, Fully Autonomous

**Date:** 2026-09-04 (26 days to Shipaton deadline)
**Status:** design approved in chat 2026-09-04, question by question. Extends `2026-08-27-hermes-pipeline-design.md`; executes the unbuilt half of `2026-09-01-window-seeding-story-audit.md` §2.5.
**Baseline:** `main` @ `6361fbc`.

---

## 0. What this is

The pipeline that authors, publishes and resolves the daily round becomes **fully autonomous** — no human gate anywhere in the daily loop. Erik is informed, never asked. `/reroll` survives as an override he rarely uses.

Six changes, in one spec because they share a thesis: **today the pipeline validates the shape of a question and takes its substance on trust.**

1. **An execution substrate that can hold the work** — cron decides, a Workflow executes.
2. **A gauntlet** that checks substance, not just shape, and is free to reject because authoring produces surplus.
3. **Adversarial resolution** — the permanent half of the ledger gets at least the scrutiny the recoverable half gets.
4. **A contestedness gate** — the pipeline can currently guarantee a *correct* round and still produce a *boring* one.
5. **A fail-closed taste gate** — the one check that must never fail open.
6. **A spend ceiling and honest narration** — an unattended loop with retries needs an upper bound and a record.

Nothing here depends on the Hermes agent. Hermes reads the day report and posts about it; the pipeline is Worker code and model calls, end to end.

---

## 1. The finding: the substantive claims are self-reported

`draft.ts` requires `resolves_at` and `lockFromResolvesAt` derives the lock from it. That closed the Sept-1 leak and it was the right fix. But the only checks on that value are that it parses and falls after the round opens.

| Claim | Who asserts it | What verifies it |
|---|---|---|
| "the answer does not exist yet" (`resolves_at`) | the author, about its own draft | that the string parses |
| "this source will settle it" (`source_url`) | the author | `z.string().url()` — the string's *shape* |
| "a stranger could resolve this identically" (`resolution_criteria`) | the author | `z.string().min(10)` |
| "this is genuinely contested" (`author_probability`) | the author | the 0.3–0.7 range, then nothing until `authorBrier` weeks later |

Every substantive property is asserted by the same model that wants its draft accepted, and validated only for shape. A model that writes `"after-lock"` for a question whose answer publishes at 8pm leaves it answerable for sixteen hours with a public answer, and nothing notices.

**The tractable part:** the pipeline already owns an adversary that is good at exactly these questions. `resolveWithClaude` takes a question and a source and returns yes / no / unverifiable with quoted receipts. Pointed *backwards*, at authoring time, `unverifiable` becomes the pass condition. Pointed *forwards*, during the open window, it makes "the lock always moves to the information" true rather than merely asserted.

---

## 2. The execution substrate: cron decides, Workflow executes

### 2.1 The limit, measured

Cloudflare Cron Triggers on a sub-hour schedule get **30 seconds CPU and a hard 15-minute wall-clock cap**. CPU is not the constraint — waiting on `fetch` is I/O. The 15 minutes is.

**This is already a latent production bug.** `runTick`'s `resolve` case loops all five questions sequentially in one invocation, and `resolve.ts`'s own header says the call "can take minutes across chained web searches." Five questions at two to three minutes each sits on the cap. It has not bitten because the pipeline has never run an unattended day. The gauntlet adds roughly eight more long calls to the authoring tick and would exceed it every night.

Cloudflare Workflows: **unlimited wall-clock per step**, 30s CPU per step (configurable to 5 minutes on paid), up to 10,000 steps, retries built in. Fan-out of long external calls is its shape.

### 2.2 What moves and what does not

**`decideActions` does not change its nature.** It stays pure over `(ETNow, PipelineState)`, with no I/O — that is what makes every action idempotent, replayable and testable, and it is a better property for *deciding* than durable execution is. The August ruling in `2026-08-27-plan-4-candidates.md` ("Workflows serves neither Hermes role") was correct for the workload as it stood; this spec changes the workload, not that reasoning.

What changes: `runTick` **starts a Workflow** for long work instead of awaiting it inline, and returns immediately.

| Action | Before | After |
|---|---|---|
| `author` | `await authorRound(deps, date)` inline | start `AuthoringWorkflow`, instance `author-{date}-{YYYYMMDDHH}` |
| `resolve` | 5 sequential resolves inline | start `ResolutionWorkflow`, instance `resolve-{date}-{YYYYMMDDHH}` |
| `forecast`, `lock`, `publish`, `void`, `settle` | inline | unchanged — all are short DB writes |

**Instance IDs carry an hour bucket**, which makes idempotency fall out of the existing throttles: `decideActions` already fires `author` and `resolve` at most once an hour (`minute < 10`), so a duplicate `create` inside the same hour collides on the ID and is skipped. A new hour gets a fresh instance, which is exactly the hourly-retry semantics the state machine already specifies. **The database stays the source of truth** for what is resolved or scheduled; a duplicate instance that does start simply finds nothing to do.

`wrangler.jsonc` gains a `workflows` binding per class; both classes are exported from the Worker entrypoint.

---

## 3. The gauntlet

### 3.1 Surplus, then select

Authoring produces **12–15 candidates**, not 5. A gauntlet that cannot afford to reject is not a gauntlet, and generating exactly the number needed makes every rejection a serial re-authoring round-trip against a six-hour window.

Candidates are not slotted at generation. Slot, big-one and the ≥4-distinct-category rule are **selection constraints applied to survivors** (§4), not authoring constraints — otherwise a rejection in one category forces a re-author rather than a substitution.

### 3.2 The four tiers, cheapest first

**Tier 0 — structural (code, free).** What `DraftQuestionSchema` enforces today, applied per candidate: category, the 0.3–0.7 band, required fields, `resolves_at` present and strictly inside the window, weather never `"after-lock"`. Plus two the Sept-1 audit named and nothing implements:

- **`topic_key`** — the model states a normalized subject key (`btc-close-above-threshold`, not the question text). Reject a key seen in the last `TOPIC_KEY_DAYS` (7). Today "will BTC close above $X" passes the text dedupe with a new X every night.
- **Compound-clause rejection** — `" and "` / `" or "` joining two predicates is the classic ambiguity generator and is worth catching before a model is spent on it.

**Tier 1 — source reachability (one HTTP GET per candidate, no model).** Fetch `source_url`; require a 2xx. A hallucinated but well-formed URL passes `z.string().url()` today and fails 24 hours later at resolution, by which point the question has already run and voids. `feeds.ts` already performs keyless HTTP, so the pattern exists. Timeout 5s; a timeout is a rejection.

**Tier 2 — the adversarial critic (one model call for the whole surviving set, Opus 5, no web search).** A separate prompt and a separate role from the author: the author advocates for its draft, this prosecutes it. Per candidate it returns:

- `readable_two_ways: boolean` — could two careful people reach different answers from the same criteria
- `criteria_determine_outcome: boolean`
- `resolves_at_plausible: boolean` — is the stated instant credible given what the question asks
- **`critic_probability: number`** — its own P(YES), stated **without ever seeing `author_probability`**
- `reasons: string[]`

The first three are rejections. `critic_probability` feeds §7.

**Tier 3 — the pre-flight resolve (one model call per survivor, Sonnet 5, domain-restricted web search).** Run `resolveWithClaude`'s machinery against the candidate *tonight*, against its own named source, and invert the meaning:

| Pre-flight result | Verdict |
|---|---|
| `yes` / `no` with quotes | **reject** — the answer already exists; this was never a prediction |
| `unverifiable` | **pass** — the answer does not exist yet, which is the requirement |

This is the check that makes the anti-leak guarantee real instead of self-reported, and it reuses machinery already hardened in production code.

**A limit, stated now rather than discovered later:** the resolver is domain-restricted to the source's own hostname, so a pre-flight `unverifiable` proves *the named source does not show it yet* — not that no source does. A question already answered on a wire service but not yet on the named source will pass. That is the right scope, because resolution will also read only that source, but the guarantee is "not answerable from the source we will judge it by," not "not knowable anywhere."

---

## 4. Selection, and what happens when the gauntlet wins

Survivors are selected into a round satisfying: five questions, slots 1–5, the Big One at slot 5, at least four distinct categories.

**Ranking among survivors:** most contested first — `|critic_probability − 0.5|` ascending — then category spread. The Big One is the most contested survivor, which is the definition `2026-08-27` already gives it.

**When fewer than five survive the constraints, in order:**

1. **Relax the category rule to three distinct**, and record that the round ran relaxed. Four categories is an interest heuristic; five valid questions matter more than the spread.
2. **Fall through to the evergreen bank.** `publish-bank` already exists and already handles poisoned entries; nothing here changes it.
3. If neither yields a round, the noon `alert` already in `decideActions` fires. The drop does not happen. That is the correct outcome — no round is better than a bad one for a ledger whose brand is that it does not lie.

There is no path in which a candidate that failed a gate is published because nothing better was available. **The gauntlet never lowers its own bar.** Relaxation applies to composition rules only, never to integrity gates.

---

## 5. In-window lock healing

`resolves_at` is a claim about the future made the night before. §3 tier 3 verifies it was true *at authoring time*; nothing verifies it stays true.

**A periodic probe during the open window.** For each open question whose `locks_at` is still ahead, run the pre-flight probe. If it returns `yes`/`no` with quotes, the answer now exists, so:

```
locks_at := min(locks_at, now)
```

The question closes immediately, regardless of what `resolves_at` claimed. This makes the stated invariant — *"the lock always moves to the information"* (`draft.ts`) — enforced rather than asserted.

**Cadence: `PROBE_INTERVAL_HOURS` = 4**, giving roughly five probes per question across a 24-hour window. Probes stop once a question locks. Cost is bounded by §9's ceiling. The probe runs as a step inside a Workflow started by a new `{kind: "probe", date}` action, decided on the same `minute < 10` throttle and gated on `claudeAvailable` exactly as `forecast` is.

**Early-locked questions stay early-locked.** A probe never moves a lock later, only earlier. `Math.min` is the whole rule.

---

## 6. Adversarial resolution

### 6.1 Why this, and why it is the priority

The design effort so far has fortified authoring. Compare the cost of error:

- A bad **question** ships → it voids → everyone scores 0 on that slot → one diminished day.
- A bad **resolution** ships → every player's points, Brier, streak, epithet and Oracle Score are permanently wrong → and the liturgy says `NOTHING REVISED`.

The second is strictly worse, permanent, and today has *less* machinery than the first: one Sonnet call, no second opinion, no disagreement detection.

### 6.2 The rule

Resolve each question **twice, with two different models** — `PIPELINE_RESOLVE_MODEL` (Sonnet 5) and `PIPELINE_RESOLVE_MODEL_B` (Opus 5) — each with the existing domain-restricted search and quote requirement.

| A | B | Result |
|---|---|---|
| `yes` | `yes` | resolve `yes` |
| `no` | `no` | resolve `no` |
| any disagreement | | **`unverifiable`** — retry next hour, void at the deadline if it persists |
| either `unverifiable` | | `unverifiable` |

**Two different models, not the same model twice.** Running one model twice correlates its errors — the second call fails the same way the first did, and agreement means nothing. Independent errors require independent models.

**Disagreement resolves to `unverifiable`, never to a winner.** The pipeline has no basis for preferring one reading, and `unverifiable` already has correct, tested behaviour: hourly retry, then void. A void is an honest "we could not read this"; a coin-flip between two disagreeing readings is a lie with a number attached. `resettleRound` remains available if a human ever corrects one by hand.

Evidence from **both** models is stored in `resolution_evidence`, so a disputed outcome is inspectable after the fact.

---

## 7. The contestedness gate

Every gate in §3 asks "is this *valid*?" None asks "is this *worth playing*?" A round the crowd agrees on 90/10 passes tiers 0 through 3 cleanly. `quality.ts` measures `uncontestedRate` — retrospectively, over a 28-day window, after the rounds have run.

**The gate uses the critic's independent probability from §3 tier 2**, which costs nothing extra and is the second opinion `author_probability` never had.

Two rejections:

- **Not contested** — `|critic_probability − 0.5| > CONTESTED_MAX_DELTA` (0.25, i.e. outside 0.25–0.75). The author's own band is 0.3–0.7; this is the same band, verified by someone else, with a little tolerance.
- **The two readings disagree** — `|author_probability − critic_probability| > PROB_DISAGREEMENT_MAX` (0.30). Two competent models this far apart on the same sentence usually means the sentence is ambiguous, not that one is badly calibrated. It is a distinct failure from either estimate being extreme, and it catches ambiguity the critic's own boolean checks miss.

**The Oracle's publish-time forecast is measurement, not a gate.** It is crowd-blind and independent, so `|oracle_p_yes − critic_probability|` and the eventual `crowd_yes_pct` say whether the gauntlet's estimate predicts anything. It arrives at publish, too late to gate, and it belongs in the day report.

---

## 8. The taste gate, fail-closed

The forbidden list — deaths, disasters or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm — lives today as a clause in the authoring prompt, checked by nothing.

With no human reading questions before they go live, one tasteless question reaching every player is the largest brand and App Review risk in the system, and it would be guarded by the same class of component that generates the risk.

**Its own call.** One narrow prompt, one model (Haiku 4.5 — this is classification, needs no search, and the 200K context is ample), one candidate set, returning `{slot, allowed: boolean, reason}` per candidate.

**Fail-closed, and it is the only gate in this design that is.** If the call errors, times out, or returns unparseable output, **every candidate in the batch is rejected.** Every other gate may fail open on infrastructure trouble; a taste check that fails open is not a taste check. The cost of failing closed is a night that falls through to the bank, which is a mechanism that already exists and is already tested.

Ordering: taste runs **last**, on the small set that survived everything else, so the fail-closed blast radius is as small as possible.

---

## 9. Spend ceiling and narration

### 9.1 The ceiling

A fully unattended loop with hourly retries has no upper bound on model calls today. A pathological night — authoring failing validation, probes retrying — spends until the window closes.

`PIPELINE_DAILY_CALL_BUDGET` (150) caps model calls per ET day, counted in a `pipeline_spend` row keyed by date and incremented before each call. On exhaustion: no further model calls that day, one `critical` alert, and the bank covers noon. Deterministic actions — lock, publish, settle, void — are never blocked by the ceiling, because they cost nothing and the game must still turn.

The budget is an ops threshold, so it lives in `pipeline/state.ts` beside `BANK_LOW_WATER`, not in `@oracle/core`.

### 9.2 Narration

The gauntlet reports what it threw away, in the Telegram message that already fires:

```
15 candidates → 5 published
rejected: 4 already-resolvable · 3 ambiguous · 2 uncontested · 1 dead source · 0 taste
```

**Deliberately not a table.** Persisting every rejected candidate is the version that supports precise tuning; the counts answer most of what anyone would ask, at zero schema cost. Promoting this to a stored table later is additive.

---

## 10. Two small ones

**DST.** `resolves_at` is a UTC instant a model derives by reasoning about "noon ET tomorrow." Across a DST boundary that reasoning is a classic failure, and the failure is silent — an hour's worth of leak. `noonET` is already DST-proof; the check is that `lockFromResolvesAt` compares against *it* and never against a model-computed noon. Add a test at a DST transition date.

**Cold start.** The first live day has no history digest, no author scorecard, no market signals if feeds are down, and an empty bank. `recentQuestionDigest` already returns `"(no history yet)"`. The gauntlet must not reject on absent history, and §4's fall-through must tolerate an empty bank by alerting rather than throwing.

---

## 11. Deliberately not in this spec

- **A stored rejection table.** §9.2's counts first; the table when directional tuning stops being enough.
- **A bank drill** — deliberately exercising `publish-bank` on a schedule so a stale parachute is found on a normal day. A real gap, operational hygiene rather than integrity.
- **Retiring or reshaping weather.** The Sept-1 audit's §1.3(d) is still open; §3 tier 0 keeps the existing "never after-lock" rule and nothing more.
- **`/hold`.** The audit asked for a human hold before publish. This spec makes the machine the gate instead, which is the whole point; `/reroll` remains as the override.
- **Moving anything to Hermes.** Nothing in the ingestion pipeline depends on it.

---

## 12. Test obligations

- **`decideActions` stays pure** over `(ETNow, PipelineState)`. The new `probe` action gets the same treatment `forecast` did: throttle, `claudeAvailable` gate, and proof it cannot fire past the lock.
- **The pre-flight's inversion is the tripwire of §3** — a candidate the resolver can answer must be rejected. Bind the test to that path and prove it rings by making the fake resolver return `yes`.
- **The taste gate's fail-closed behaviour gets a test per failure mode**: throw, timeout, and unparseable output must each reject the whole batch. A fail-closed gate that has only been tested on the success path is not known to be fail-closed.
- **Resolution disagreement** — `yes`/`no` across the two models must produce `unverifiable` and must not write an outcome. Assert the DB row is untouched, not merely that the function returned false.
- **Lock healing never moves a lock later.** Property test over random `locks_at` and probe times.
- **The spend ceiling blocks model calls and does not block `lock`/`publish`/`settle`/`void`.**
- **DST**: `lockFromResolvesAt` at a transition date.
- All model calls injected through `PipelineDeps`; fixtures only; no test touches the network.

---

## 13. Open, and Erik's

1. **Thresholds are guesses.** `CONTESTED_MAX_DELTA` 0.25, `PROB_DISAGREEMENT_MAX` 0.30, `TOPIC_KEY_DAYS` 7, `PROBE_INTERVAL_HOURS` 4, `PIPELINE_DAILY_CALL_BUDGET` 150, candidate count 12–15. Every one is a first guess and should be read as such until §9.2's counts show what the gauntlet actually rejects. Expect to tune them in the first live week.
2. **Cost.** Roughly $1.15 a night at these settings (~$35/month), before the Batch API's 50% on the nightly half and prompt caching on the stable prompt prefix, which together should bring it to $20–25. Worth measuring rather than assuming.
3. **`claude.ts` declares `web_search_20250305`.** The current variant for Opus 5 and Sonnet 5 is `web_search_20260209`, which adds dynamic filtering — directly useful here. Worth changing regardless of this spec.
4. **The pre-flight's domain restriction** (§3 tier 3) is a deliberate scope choice, not an oversight. If leak telemetry later shows questions arriving pre-answered from elsewhere, widening the pre-flight's search is the lever.
