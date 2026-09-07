# Forecasting Learning at Launch — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Help players understand how confidence affected today's result and see factual patterns in their accumulated predictions.

**Architecture:** Add a pure confidence-history calculator to core and expose its result through the existing ledger endpoint. Extend the existing reveal with deterministic scoring explanations and paired resolution evidence. Derive everything from stored predictions and outcomes; no new tables, scoring rules, or generation service.

**Tech Stack:** TypeScript, Zod, Vitest, Hono/Drizzle, Expo 57 / React Native, existing React Query and analytics.

**Spec:** The product design below is the specification for this plan. It extends `docs/superpowers/specs/2026-09-06-gameplay-experience-design.md` for these two features only.

**Status:** Proposed for review, September 7, 2026. Planning only; application changes are not part of this task. Thresholds below are proposed product choices, not validated statistical thresholds.

## Global constraints

- Keep five daily questions and confidence at 55–95 in steps of 5.
- Oracle Score requires 50 rated calls and uses the latest 100 rated calls; neither changes.
- Keep seals, question locks, prospective rules versions, duel eligibility, and scoring unchanged.
- No crowd, market, or Oracle forecasts before the player's answer is sealed.
- Confidence history grants no points, rank, or superforecaster designation.
- iOS first; read `apps/mobile/AGENTS.md` and exact Expo 57 documentation before writing mobile code.
- Use existing dependencies and typography. Support VoiceOver, large text, reduced motion, and accessible expand/collapse controls.
- Seasons, prizes, partnerships, assessments, training courses, and new AI-generated lessons are outside launch scope.

## Product design

### Approach and tradeoffs

Recommend descriptive receipts: confidence counts in the ledger and scoring/evidence explanations in the reveal. This uses data already collected and avoids claiming more than the record demonstrates.

A full calibration chart with statistical intervals is a possible later extension, but introduces substantial interpretation work on a small phone screen. Personalized coaching and skill labels require stronger validation and editorial controls. Neither is necessary to test the launch experience.

### 1. Confidence history in the ledger

Replace the ledger's `calibrationVerdict(...)` presentation. Its current statements, including “YOUR CONFIDENCE IS HONEST,” infer too much from a difference between two lifetime averages. Keep unrelated epithets and existing stats unchanged in this work.

Add a section below the score and existing record facts, titled **YOUR CONFIDENCE, TESTED**. This is descriptive personal history, distinct from competitive Oracle Score.

Population: all of this user's resolved yes/no predictions, including predictions from incomplete rounds. This matches the current ledger's accuracy population. Each question counts once, including the Big One. Pending, void, unanswered, missing-question, and invalid-confidence records do not count. Label the population “All resolved calls · lifetime”; explain in optional detail that some calls do not qualify toward the competitive score.

Group by the exact nine confidence values; do not merge 75 and 80 or label their combined mean “80%.” Use lifetime counts at launch, not the score's latest-100 window. Do not describe lifetime history as recent improvement.

Proposed display rule: a confidence level becomes eligible for the headline at **20 resolved calls at that level**. This reduces very sparse headline observations; it is not evidence of statistical significance or a skill certification. There is no additional 50-call gate.

Headline selection: choose the eligible level with the largest count; break count ties by lower confidence. Never choose the largest apparent error, which would preferentially highlight noise. Exact copy example: “Of your 40 calls at 80% confidence, 29 were right.” Follow with “80% means expecting about 8 in 10 over many calls. Small samples vary.” Avoid declaring overconfidence, underconfidence, improvement, or honesty.

Before any level reaches 20, show the most-used nonempty level: “12 of 20 resolved calls at 80% toward a confidence snapshot.” Supporting copy: “This builds as your predictions resolve. Choose the confidence you believe.” At zero: “Your confidence history starts when your calls resolve.” Never promise an unlock after a fixed number of days or encourage choosing a confidence level to fill its bar.

Expanded detail shows every used confidence level in ascending order, each with raw correct/total counts. Mark rows below 20 as “Early record.” No red/green skill grading. Keep the explanation “These are results so far, not a measure of certainty about your ability.” History may change after an outcome correction or void; recompute from current records rather than persisting an unlock or achievement.

### 2. Teach through the reveal

Keep the result visible immediately. Use the existing highlight selection and show a concise explanation alongside it; do not add a new screen or required tap before the result.

For a resolved answered highlight, state the player's confidence and actual **base points**, calculated with `oracleQuestionPoints`. Example structure: “You chose YES at 80%. The result was NO: [actual signed base points] base points.” Add: “Higher confidence makes a correct call worth more and a miss cost more.” Mention double weight for the Big One. Never interpolate stored bonus-inclusive points into this base-score explanation.

For a valid v2 duel, show the Oracle's base points on that same question and its contribution to the gap. Call it a highlight on tied duels. Do not claim that a single question caused the win unless counterfactual arithmetic establishes that claim. Legacy rounds retain their existing result semantics; a per-call base explanation must not imply that it explains a legacy overall comparison.

Remove the scolding ending “CONVICTION HAS A COST” from the existing highest-confidence-miss observation. Avoid stacking that observation with the new explanation of the same call. A high-confidence miss alone is not proof of a bad forecast.

Each resolved question, including the Big One, gets optional **WHY THIS RESOLVED** detail. Show a stored evidence quote linked to the URL belonging to that exact quote. The current reveal exposes `evidence_quote` but only a separate question `source_url`; these can refer to different pages and must not be paired by assumption.

Only render a quote when its paired URL parses as HTTP or HTTPS. If no valid pair exists, retain the ordinary source link where available and say “No resolution excerpt available.” Do not invent an explanation or present internal resolver reasoning as a verified causal account. Pending questions show their existing pending state; voids show the void reason; neither receives a scored lesson.

Launch teaches confidence mechanics and documents outcomes. Base-rate lessons and explanations of evidence available before sealing are deferred until the authoring workflow stores verified, timestamped pre-seal context. Later outcome evidence must never be described as something the player should have known.

### Acceptance examples

- 19 calls at 80%: building state. The twentieth: eligible factual snapshot.
- 50 calls spread across confidence levels with none at 20: score may exist; confidence headline remains building.
- 20 calls at 80% and 20 at 85%: select 80%, regardless of which looks more accurate.
- A 40-call 80% history with 29 correct prints those exact counts; both YES and NO choices work.
- A Big One contributes one history observation but double-weighted base points in the reveal.
- A correction from YES to NO changes correct counts; changing to void reduces total and can return a snapshot to building.
- A pending round produces no final duel explanation. Resolved per-question evidence remains inspectable.
- Missing Oracle predictions still permit the player's scoring receipt and source evidence.
- An evidence quote from a different page opens its own page, not the question's original URL.

## Implementation sequence

### Task 1: Core history calculation and contract

**Files:** Create `packages/core/src/confidenceHistory.ts` and `packages/core/test/confidenceHistory.test.ts`; modify `packages/core/src/schemas.ts` and `packages/core/src/index.ts`.

**Interfaces:**

```ts
type ConfidenceCall = { confidence: number; correct: boolean };
type ConfidenceBucket = { confidence: number; total: number; correct: number };
type ConfidenceHistory = {
  scope: 'lifetime_resolved';
  min_bucket_calls: number;
  buckets: ConfidenceBucket[];
};
// Buckets include only valid, nonempty confidence levels, sorted ascending.
function confidenceHistory(calls: readonly ConfidenceCall[]): ConfidenceHistory;
```

- [ ] Add a calculator test with 40 calls at 80, 29 correct; expect `{confidence:80,total:40,correct:29}`. Add mixed-confidence and invalid-confidence cases, including 50, 100, NaN, and 82.
- [ ] Run `pnpm --filter @oracle/core test` and confirm the new missing implementation fails.
- [ ] Implement counting with a Map keyed by the nine allowed values. Return scope, `min_bucket_calls: 20`, and sorted buckets; do not calculate a skill verdict.
- [ ] Add optional `confidence_history` to `MeLedgerSchema`, validating integer counts, correct <= total, allowed confidence values, sorted unique buckets, and the literal scope. Optional supports an older API; absence must not be decoded as zero history.
- [ ] Run core tests and typecheck. Review and commit only this task's files.

### Task 2: Server history and evidence provenance

**Files:** Modify `apps/api/src/routes/me.ts`, `apps/api/src/resolution.ts`, `apps/api/src/routes/round.ts`, `packages/core/src/schemas.ts`; extend `apps/api/test/ledger.test.ts` and `apps/api/test/resolve-reveal.test.ts`.

**Interfaces:** Ledger emits `confidence_history: ConfidenceHistory`. Extend `evidenceSummary` with `quoteUrl: string | null`; reveal adds optional nullable `evidence_url`, paired with `evidence_quote`.

- [ ] Add ledger fixtures for partial rounds, both prediction sides, Big One, pending and void outcomes, and corrected outcomes. Assert one observation per resolved prediction and unchanged score/duel fields.
- [ ] Add reveal fixtures where the stored quote URL differs from source URL, where URL is missing, and where its scheme is unsafe. Assert only valid paired quotes are exposed and legacy payloads still decode.
- [ ] Run API tests to confirm the new assertions fail before edits.
- [ ] Call the core calculator with existing `resolved` rows in the ledger route; add no database query or persisted counter.
- [ ] In `evidenceSummary`, select the first nonempty quote with a valid paired HTTP(S) URL; return both together. Preserve independent void reasons. Add `evidence_url` to reveal response and schema. Preserve existing `source_url` as the ordinary source link.
- [ ] Run core/API tests and typechecks. Review and commit this task's files.

### Task 3: Ledger presentation

**Files:** Create `apps/mobile/src/game/confidenceHistoryView.ts`, `apps/mobile/test/confidenceHistoryView.test.ts`, and `apps/mobile/src/components/ConfidenceHistory.tsx`; modify `apps/mobile/src/app/ledger.tsx`.

**Interfaces:** `confidenceHistoryView(history: ConfidenceHistory)` returns `{state: 'empty'|'building'|'ready', selected: ConfidenceBucket|null}` using the exact selection policy above. The component accepts `history: ConfidenceHistory`; it owns only expanded/collapsed UI state.

- [ ] Add tests for 0/19/20 calls, 50 scattered calls, tie selection, larger-count selection, and corrected counts dropping below 20.
- [ ] Run mobile tests to confirm failures; implement the pure selector and rerun tests.
- [ ] Replace the ledger's calibrationVerdict block with the component. If the API field is absent, hide this section; do not show a false empty record or fall back to the old verdict.
- [ ] Render the specified factual copy and expandable ascending rows with existing visual primitives. Expose button role and expanded state; read percentages and counts intelligibly with VoiceOver. No new animation required.
- [ ] Manually inspect empty, building, ready, and expanded states on small iPhone layouts and large text. Confirm the score explanation still differentiates rated calls.
- [ ] Run mobile typecheck and tests; review and commit this task's files.

### Task 4: Reveal explanations and evidence detail

**Files:** Create `apps/mobile/src/game/revealLearning.ts`, `apps/mobile/test/revealLearning.test.ts`, and `apps/mobile/src/components/ResolutionEvidence.tsx`; modify `apps/mobile/src/app/reveal/[date].tsx` and `apps/mobile/src/game/revealObservation.ts`.

**Interfaces:** `revealLearning(question: DuelQuestion, rulesVersion: number, duel: DuelResult)` returns `null` for unanswered/pending/void questions; otherwise `{playerBasePoints: number, oracleBasePoints: number|null, gap: number|null, doubleWeight: boolean}`. Oracle comparison fields are populated only for complete v2 duels. The screen uses its existing selected highlight. Evidence component accepts `{outcome, quote, quoteUrl, sourceUrl, voidReason}` from the reveal payload.

- [ ] Test YES/NO correct and incorrect calls, confidence values 55 and 95, Big One weight, missing Oracle forecast, ties, v1 rounds, unanswered, pending, and void cases. Calculate expected base-point values from the shared core rule, with at least one manually checked numeric fixture to avoid testing only self-consistency.
- [ ] Run mobile tests to confirm failures; implement the helper using `oracleQuestionPoints`, without duplicating its formula.
- [ ] Add one visible highlight receipt and optional evidence detail to both ordinary questions and the Big One. Keep result, pending state, and existing share eligibility unchanged.
- [ ] Remove the scolding observation ending and suppress duplicate highest-confidence-miss commentary where the new receipt already covers it.
- [ ] Use the paired evidence URL only for its quote; validate link scheme defensively before opening. Handle older API responses by showing the source fallback, never an unpaired quote.
- [ ] Verify v1 historical result wording, missing-data states, large text, VoiceOver, and reduced motion. Run mobile typecheck/tests and commit after review.

### Task 5: Release verification and learning

**Files:** Record results in `docs/gameplay/forecasting-learning-launch-verification.md`; modify existing analytics calls in ledger/reveal only if configured analytics is usable.

- [ ] Run `pnpm test` and `pnpm typecheck` once after integration; investigate failures before declaring completion.
- [ ] Use seeded test records for every acceptance example; screenshots must be labeled as fixtures, not live performance.
- [ ] If analytics is configured, record `confidence_history_viewed` with state only, `confidence_history_expanded`, and `resolution_evidence_opened` with round/question IDs. Deduplicate view events per screen visit; do not send confidence histories, answer text, or evidence quotes. If unavailable, record the playtest manually without adding a service.
- [ ] Observe five new players through a round and its reveal. Then show a clearly labeled seeded history because a launch playtest cannot accumulate 20 calls at one confidence immediately.
- [ ] Formative acceptance: at least four of five explain why confidence affects points, interpret correct/total counts, and understand that the snapshot does not certify their forecasting ability. Note this is a usability check, not statistical validation.
- [ ] Confirm play-today remains easy to reach and neither feature adds required steps. Review source links against the displayed quote for each fixture.
- [ ] Ship the additive API before the mobile build. Feature rollout requires passing checks and review; this plan does not itself deploy anything.

## Sequencing and deferred work

Implement reveal learning first if launch time becomes constrained: it benefits the first resolved round. Confidence history can follow independently once its API and UI are ready. Both are additive to the existing gameplay plan; reconcile concurrent edits before execution.

Monthly seasons stay after launch. Revisit when observed players understand results and return for more rounds; then design eligibility, missed-day treatment, tie rules, scoring periods, and historical records as a separate feature. No season code or database fields belong in this change.

Research partnerships remain a separate business track. Nothing here labels players superforecasters, claims skill transfer, or exports their records to a partner.
