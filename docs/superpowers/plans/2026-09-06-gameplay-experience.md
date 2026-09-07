# ORACLE Gameplay Experience Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Use subagents only if the user explicitly requests delegation. Steps use checkbox syntax for tracking.

**Goal:** Make the first round understandable, the result worth returning for, and the competition fair and compelling from the first week.

**Architecture:** Reuse the existing mobile experience, core scoring package, and question pipeline. Add pure shared presentation/duel helpers, improve the mobile flow incrementally, and isolate changes to scoring and completion behind a persisted prospective round rules version. Each phase can be reviewed independently.

**Tech Stack:** Expo 57, React Native, TypeScript, Skia, Zustand, Hono, Drizzle/Postgres, Vitest; no new libraries or services.

**Spec:** [Gameplay experience design](../specs/2026-09-06-gameplay-experience-design.md)

**Status:** Implementation built locally on `codex/gameplay-experience`. See [implementation and validation evidence](../../gameplay/playtest-results.md) for completed deliverables and pending native/human checks. The checkboxes below retain the original granular acceptance requirements; combined code/commit/manual steps are not claimed complete without their manual evidence. No production deployment or migration has occurred.

## Implementation status

| Task | Local deliverable | Remaining acceptance work |
|---|---|---|
| 1. Introduction | Implemented | First-install/returning native walkthrough |
| 2. Practice and confidence | Implemented; shared mechanics remain unscored | VoiceOver, gesture interruption, large text, reduced motion |
| 3. Availability and review | Availability helper and editorial rubric implemented | Review 15 real candidates |
| 4. Duel | Shared versioned scoring and eligibility implemented and unit-tested | Real-player interpretation |
| 5. Reveal | Immediate summary, highlight, source and optional detail/share implemented | Native result/share walkthrough |
| 6. Milestones | Factual milestones and conservative observation implemented | Real first-week experience |
| 7. Small crowd and return | Personal receipts and return copy implemented | Native low-crowd/missed-day walkthrough |
| 8. Editorial pipeline | Gate, selection and frozen context implemented and tested | Human source/neutrality review |
| 9. Versioned fairness | Additive migration and API integration implemented | Coordinated release and real-data migration |
| 10. Acceptance test | Protocol, events and honest results record added | Five real participants across two sessions |

## Global constraints

- iOS first; use the existing Expo/React Native stack and installed libraries.
- Read `apps/mobile/AGENTS.md` and the exact Expo 57 documentation before mobile implementation.
- No crowd probabilities, market probabilities, or Oracle forecasts before the player's answer is sealed.
- No unsealing, replaying a scored question, fabricated players, or fabricated Oracle forecasts.
- Confidence remains 55–95 in steps of 5.
- Oracle Score requires 50 rated calls and uses the latest 100 rated calls.
- Preserve real question locks, evidence links, and explicit pending/void states.
- Respect VoiceOver, large text, reduced motion, and the button-based equivalent of the gesture.
- Preserve public historical results; rules changes apply prospectively under a stored round rules version.
- No new third-party services, subscription features, or submission work.

Paths below are repository-relative. Commands run from the repository root. Read the spec before each phase. Existing files are verified against the September 6 checkout; all paths labeled Create are proposed new files. Recheck the checkout at execution because other work may have landed.

## Coverage and order

| Review recommendation | Deliverable | Task |
|---|---|---|
| 1. Teach through play | Three-idea opening and contextual rules | 1 |
| 2. Safe first gesture | Unscored practice using shared mechanics | 2 |
| 3. Explain confidence | Plain labels plus payoff | 2 |
| 4. Define beating the Oracle | One shared duel contract | 4 |
| 5. Strong reveal order | Immediate result and decisive question | 5 |
| 6. Interesting questions | Manual rubric, then editorial selection/context | 3, 8 |
| 7. Fair availability | Accurate messaging, then versioned completion | 3, 9 |
| 8. Meaningful first week | Factual milestones and one observation | 6 |
| 9. Streak consequences | Prospective recognition-only multipliers | 9 |
| 10. Small crowd and return | Complete solo experience and easy reentry | 7 |

Execute Phase A tasks 1–3, then Phase B tasks 4–7, then Phase C tasks 8–10. Task 8's human review begins in Task 3, so question quality improves while interface work proceeds. Tasks 4–7 initially use a conservative duel eligibility contract: all five answered, every question resolved, at least three non-void questions, Oracle coverage of all scored questions. Task 9 introduces version-aware eligibility everywhere together.

## Phase A — First-round clarity

### Task 1: Replace the opening rule wall with an introduction

**Modify:** `packages/core/src/copy.ts`, `packages/core/test/copy-lint.test.ts`, `apps/mobile/src/app/rites.tsx`, `apps/mobile/src/app/index.tsx`, `apps/mobile/src/api/flags.ts`.

**Interfaces:** Keep `getRitesSeen()` and `markRitesSeen()` for veteran bypass. Add `INTRO_LINES: readonly string[]` to the core copy module, exported through `packages/core/src/index.ts`. The full `RITES_LINES` stays the reference; the introduction is not a slice of that array.

- [ ] Add the three opening ideas from the spec, with `BEGIN`, `PRACTICE THE PULL`, and optional `THE RITES` actions. Keep the Calling skippable and do not extend its duration.
- [ ] Make the full rites readable without marking the player as having completed or skipped practice. Preserve existing navigation for returning users.
- [ ] Move Big One weight explanation to its pre-seal card; show complete-round/rating explanation after the round and when early closures affect eligibility. Do not remove rules from the reference.
- [ ] Update the existing copy constraints intentionally: remove tests that require fifty-call/streak rules in the opening, retain tests that protect accurate numbers wherever those rules appear. Do not weaken the general copy lint to accommodate a single new phrase.
- [ ] Validate with `pnpm --filter @oracle/core test` and `pnpm --filter @oracle/mobile typecheck`; manually inspect first install, veteran bypass, full rites return, large text, and VoiceOver.
- [ ] Commit only the reviewed introduction changes: `feat(mobile): teach the daily premise before the first round`.

**Done:** A player can reach the first card without reading about shields, multipliers, or a fifty-call qualification period.

### Task 2: Safe practice and understandable confidence

**Create:** `apps/mobile/src/app/practice.tsx`, `apps/mobile/src/ui/PracticeCard.tsx`.
**Modify:** `apps/mobile/src/ui/OracleCard.tsx`, `apps/mobile/src/game/confidence.ts`, `apps/mobile/src/game/swipeLean.ts`, `apps/mobile/src/api/flags.ts`, `apps/mobile/src/app/rites.tsx`, `apps/mobile/test/confidence.test.ts`, `apps/mobile/test/swipeLean.test.ts`.

**Interfaces:** Reuse `leanRelease(dx, cardWidth)` and `holdConfidence(heldMs)`. Add `confidenceMeaning(c: number): string` and persisted `getPracticeSeen(): Promise<boolean>` / `markPracticeSeen(): Promise<void>`. Practice uses local component state, never `roundStore` or prediction hooks.

- [ ] Add behavior assertions to the existing pure tests before changing the UI:

```ts
expect(leanRelease(0, 300)).toBeNull();
expect(leanRelease(36, 300)).toEqual({ answer: true, confidence: 55 });
expect(holdConfidence(1600)).toBe(95);
expect(confidenceMeaning(95)).toBe("ALMOST CERTAIN");
expect(confidenceMeaning(55)).toBe("SLIGHTLY LEANING");
```

- [ ] Run `pnpm --filter @oracle/mobile test` and confirm the new confidence helper assertion fails before implementation.
- [ ] Implement the nine labels exactly as specified. Keep percentages and `payoffLine` visible. Replace the certainty claim in atmospheric copy.
- [ ] Build practice around the shared pure mechanics. Label it `PRACTICE · NOTHING IS RECORDED`, provide `TRY AGAIN` and `BEGIN`, and show a sample answer/confidence receipt without scoring it. Expose a cancel path for the hold-button mode and verify canceled gestures never commit.
- [ ] Avoid duplicating network-aware `OracleCard` behavior. Extract a small shared presentational control only if required for visual parity; keep live submission in the live card.
- [ ] Verify practice creates no HTTP prediction request, no daily progress, no streak, and no notification prompt. Test repeated practice, skip, storage failure, reduced motion, and accessible controls on device.
- [ ] Run mobile tests/typecheck, then commit: `feat(mobile): add unscored gesture practice and clear confidence labels`.

**Done:** A newcomer can explore, cancel, and release without spending a live answer, and can explain confidence in words.

### Task 3: Accurate availability and a human question-quality baseline

**Create:** `apps/mobile/src/game/roundAvailability.ts`, `apps/mobile/test/roundAvailability.test.ts`, `docs/gameplay/question-review.md`.
**Modify:** `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/round.tsx`, `apps/mobile/src/ui/OracleClock.tsx`, `apps/mobile/src/ui/OracleCard.tsx`, `packages/core/src/copy.ts`.

**Interfaces:** `roundAvailability(questions: Array<{id:string; locks_at:string}>, sealedIds: ReadonlySet<string>, nowMs:number): {openCount:number; missedCount:number; earliestOpenLock:string|null; completeStillPossible:boolean}`. Complete remains the existing all-five rule in this task.

- [ ] Add fixtures for before every lock, one expired unanswered question, one expired sealed question, exactly at lock, and all closed. The following must hold:

```ts
const qs = [{ id: "a", locks_at: "2026-09-07T15:00:00Z" }];
const atLock = Date.parse(qs[0].locks_at);
expect(roundAvailability(qs, new Set(), atLock).completeStillPossible).toBe(false);
expect(roundAvailability(qs, new Set(["a"]), atLock).missedCount).toBe(0);
```

- [ ] Implement from actual lock timestamps and existing sealed state. Render remaining playable count, earliest deadline, and an honest rating-eligibility message before entry. A closed card must not look answered.
- [ ] Replace unconditional “return at noon” promises with the scheduled time or pending explanation as appropriate. Keep the New York daily schedule and local display unambiguous around daylight-saving transitions.
- [ ] Review 15 real candidate questions in the document. For each record text, source, resolution criterion, expected lock, three 0–2 rubric scores, reason for either answer, rewrite, and keep/reject decision. Clearly label any illustrative examples as examples.
- [ ] Assemble three sample rounds from accepted questions; identify accessible opener and meaningful Big One. Do not publish or rewrite live rounds during the review.
- [ ] Run mobile tests/typecheck and manually test entering after an early closure. Commit: `feat(mobile): explain round availability before commitment`.

**Done:** The app no longer suggests a full rated day is available when it is already impossible; the editorial work has concrete examples rather than only prompt changes.

## Phase B — A daily payoff worth returning for

### Task 4: One confidence-based Oracle duel

**Create:** `packages/core/src/duel.ts`, `packages/core/test/duel.test.ts`.
**Modify:** `packages/core/src/index.ts`, `packages/core/src/oracleRecord.ts`, `apps/api/src/routes/me.ts`, `apps/mobile/src/game/dailyBoard.ts`, `apps/mobile/src/ui/ShareCard.tsx`, `apps/mobile/src/ui/PlaqueShareCard.tsx`, `apps/mobile/test/dailyBoard.test.ts`, `apps/api/test/ledger.test.ts`.

**Interfaces:**

```ts
export type DuelQuestion = {
  id: string; slot: number; is_big_one: boolean;
  outcome: "yes" | "no" | "void" | null;
  oracle_p_yes: number | null;
  my: { answer: boolean; confidence: number } | null;
};
export type DuelResult =
  | { status: "pending" | "incomplete" | "insufficient" | "unavailable" }
  | { status: "complete"; youPoints: number; oraclePoints: number;
      winner: "you" | "oracle" | "tie"; scoredCount: number;
      youCorrect: number; oracleCorrect: number; oracleAbstained: number;
      highlightId: string };
export function calculateDuel(qs: DuelQuestion[]): DuelResult;
```

- [ ] Write tests for equal probabilities/tie, high-confidence wrong answers, Big One weighting, voids, pending, missing player answer, missing Oracle probability, 0.5, and fewer than three scored questions.
- [ ] Include a fixture where the player gets more answers right but loses on points. Add a fixture whose stored player points would include a crowd bonus; the calculator must not consume that field.
- [ ] Implement with the same base scoring function for both sides. Convert the player's answer/confidence into `pYes`; reuse `oracleQuestionPoints` for identical rounding. Do not round summed unrounded values differently for the two participants.
- [ ] Make correct counts explicit about scored coverage and abstentions. Derive the highlight from the largest absolute per-question gap, breaking ties by slot.
- [ ] Replace the current correct-count “days outseen” aggregation for new duel displays with the shared calculation. Preserve legacy publicly displayed rivalry history until Task 9 versions that history; label the new confidence-based comparison distinctly during transition.
- [ ] Use the shared result in daily/ledger share data. No complete result means no victory claim. Never silently substitute a crowd aggregate for a missing forecast.
- [ ] Run core/mobile tests and focused API ledger tests, then typecheck. Commit: `feat(core): define a shared confidence-based Oracle duel`.

**Done:** Every new duel surface agrees on who won and why, independently of crowd size and player-only bonuses.

### Task 5: Rebuild the reveal's information order

**Create:** `apps/mobile/src/game/revealSummary.ts`, `apps/mobile/test/revealSummary.test.ts`, `apps/mobile/src/ui/RevealSummary.tsx`.
**Modify:** `apps/mobile/src/app/reveal/[date].tsx`, `apps/mobile/src/game/revealRows.ts`, `apps/mobile/src/ui/ShareCard.tsx`, `apps/mobile/test/revealRows.test.ts`.

**Interfaces:** `revealSummary(qs: DuelQuestion[], duel: DuelResult): {headline:string; highlightId:string|null; explanation:string|null; canShareFinal:boolean}`. Consume Task 4's exact types; no independent winner calculation.

- [ ] Test complete win/loss/tie, more-correct-but-lower-score, pending, all void, no Oracle forecast, and spectator cases. Pending must set `canShareFinal` false; never describe a void as wrong.
- [ ] Render summary, highlighted question, comparison explanation, a reserved milestone slot, share, then expandable details/board. Preserve every evidence link and all five question receipts.
- [ ] Use immediate results. Remove animation ordering that pretends the total is unknown after it is visible. Do not force a tap per question; animations must be skippable through reduced motion.
- [ ] If the decisive question is not the Big One, show the actual decisive question first and retain the Big One in details. For tied results call the selected card a highlight.
- [ ] Keep share eligibility dependent on a fully resolved factual result; keep a personal result share possible when the Oracle is unavailable, without a rivalry claim.
- [ ] On a small iPhone and large text, verify the headline and explanation are visible before the board. Check scroll reachability, no overlapping source text, and VoiceOver reading order.
- [ ] Run mobile tests/typecheck, then commit: `feat(mobile): lead the reveal with the result and its decisive call`.

**Done:** A player can identify their result and the reason within a few seconds, then inspect evidence voluntarily.

### Task 6: First-week milestones and restrained learning feedback

**Create:** `packages/core/src/milestones.ts`, `packages/core/test/milestones.test.ts`, `apps/mobile/src/game/revealObservation.ts`, `apps/mobile/test/revealObservation.test.ts`.
**Modify:** `packages/core/src/index.ts`, `packages/core/src/schemas.ts`, `apps/api/src/routes/me.ts`, `apps/api/test/ledger.test.ts`, `apps/mobile/src/app/ledger.tsx`, `apps/mobile/src/app/reveal/[date].tsx`, `apps/mobile/src/api/flags.ts`.

**Interfaces:**

```ts
export type MilestoneId = "first_round" | "first_result" | "first_oracle_win"
  | "three_rounds" | "seven_rounds";
export function earnedMilestones(facts: {
  completedRounds: number; resolvedCompletedRounds: number; oracleWins: number;
}): MilestoneId[];
```

- [ ] Add tests for zero history, first completed/unresolved round, first resolved round, three/seven distinct dates, and first valid win. Count rounds, not individual calls or consecutive logins.
- [ ] Extend the ledger response with an additive `milestones` array, defaulting to empty for older responses. Derive facts server-side from existing records and the shared duel result; local flags only remember shown celebration IDs.
- [ ] Render at most one new celebration per reveal visit, in spec priority order. Retain all earned milestones in the ledger and after a missed day. A reinstall may replay a ceremony but cannot grant a new competitive benefit.
- [ ] Add one deterministic observation: select a unique maximum-confidence scored player answer; show the high-confidence-miss line only if it was wrong. Suppress tied maxima, pending, void, and insufficient evidence. No personality diagnosis or extrapolated accuracy.
- [ ] Keep `UNWRITTEN` and the 50-call floor accurate but secondary. Do not add a fabricated provisional Oracle Score.
- [ ] Run core/mobile tests and API ledger tests; verify empty/older ledger payloads, then commit: `feat(game): recognize factual progress before the formal rating`.

**Done:** The first week has earned progress without weakening the statistical gate or rewarding compulsive attendance.

### Task 7: Complete low-crowd play and welcoming reentry

**Modify:** `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/round.tsx`, `apps/mobile/src/ui/CrowdReveal.tsx`, `apps/mobile/src/game/homeLines.ts`, `apps/mobile/src/game/dailyBoard.ts`, `apps/mobile/test/homeLines.test.ts`, `apps/mobile/test/dailyBoard.test.ts`, `packages/core/src/copy.ts`.

**Interfaces:** Reuse the duel result and existing crowd/board thresholds. No new social identity or fake population data.

- [ ] Create fixtures for crowd sizes 0, 1, 4, 5, 19, and 20, plus Oracle failure and partial player participation. Keep every existing threshold unchanged.
- [ ] Ensure the sealed personal receipt remains complete below the crowd floor; show a single quiet gathering line rather than an empty chart. The valid Oracle duel remains visible below the board floor.
- [ ] Give a returning player a direct `PLAY TODAY` action when yesterday's results are unread. Do not auto-open a rescue purchase or require reading a missed-day verdict before entry.
- [ ] Preserve historical calls, skill, and earned milestones in lapse copy. State the streak break once without implying the whole record was lost.
- [ ] Manually walk day one with zero crowd, day two with results, a missed day, all questions closed, and no Oracle forecast. Verify each state has an honest next action.
- [ ] Run mobile/core tests and typecheck; commit: `feat(mobile): make solo play and returning after a gap feel complete`.

**Done:** Population growth is additive to the experience, and absence does not obstruct the next round.

## Phase C — Editorial quality and prospective fairness rules

### Task 8: Editorial selection and optional frozen context

**Create:** `apps/api/src/pipeline/editorial.ts`, `apps/api/test/pipeline-editorial.test.ts`.
**Modify:** `apps/api/src/pipeline/candidate.ts`, `apps/api/src/pipeline/draft.ts`, `apps/api/src/pipeline/author.ts`, `apps/api/src/pipeline/gauntlet/select.ts`, `apps/api/src/pipeline/gauntlet/index.ts`, `apps/api/src/db/schema.ts`, `packages/core/src/schemas.ts`, `apps/api/src/routes/round.ts`, `apps/mobile/src/ui/OracleCard.tsx`, `apps/api/test/gauntlet-select.test.ts`, `docs/gameplay/question-review.md`.
**Generate:** the next Drizzle migration and metadata using the existing migration command; do not hand-select a migration number that may collide with another branch.

**Interfaces:** Introduce `EditorialAssessment = {understandability:0|1|2; reasonability:0|1|2; interest:0|1|2; opener:boolean; bigOne:boolean}`. Optional persisted context is `{text:string; asOf:string; sourceUrl:string}`; its schema caps text at 240 characters and validates timestamp/URL. Older candidates/rounds use absent assessments/context without crashing.

- [ ] Use Task 3's reviewed examples to write explicit editorial prompt examples and rejection explanations. Reject any zero-score candidate from editorial selection; never admit an integrity-rejected candidate.
- [ ] Test a candidate nearest 50% losing the Big One slot to a more meaningful candidate, an accessible opener, category diversity, duplicate topics, fewer than five usable candidates, and deterministic tie handling.
- [ ] Apply the existing integrity pipeline first, editorial assessment second, and composition last. Choose the opener by understandability then interest; choose the Big One by interest then reasonability among marked candidates; use stable input order to break remaining ties. Preserve existing category diversity/fallback behavior.
- [ ] On missing/unparseable editorial output, use already validated fallback content rather than bypassing integrity. Keep human review notes to identify systematic weak questions.
- [ ] Carry optional verified context through candidate/draft, persistence, publish, and the today payload. Reject context from after publish time; exclude suggested probabilities, recommendations, and outcome-bearing information through the same human/pipeline review. A timestamp check alone cannot establish factual neutrality.
- [ ] Render context behind a short optional details control before the seal. Freeze it at publish. Verify it does not reveal the outcome or alter after refresh and that old rounds with no context remain readable.
- [ ] Generate/review the additive migration; test select/editorial/schema/round fixtures, run typecheck, and commit: `feat(pipeline): compose rounds for interest and accessible reasoning`.

**Done:** Question ordering is justified by player interest and reasoning, rather than contestedness alone. No production publication occurs as part of the test.

### Task 9: Versioned completion and recognition-only streaks

**Create:** `packages/core/src/roundRules.ts`, `packages/core/test/roundRules.test.ts`.
**Modify:** `packages/core/src/index.ts`, `packages/core/src/schemas.ts`, `packages/core/src/scoring.ts`, `packages/core/src/duel.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/pipeline/draft.ts`, `apps/api/src/pipeline/actions.ts`, `apps/api/src/pipeline/probe.ts`, `apps/api/src/settlement.ts`, `apps/api/src/resolution.ts`, `apps/api/src/routes/round.ts`, `apps/api/src/routes/me.ts`, `apps/mobile/src/game/revealRows.ts`, `packages/core/src/copy.ts`.
**Tests:** `apps/api/test/settlement.test.ts`, `apps/api/test/ledger.test.ts`, `apps/api/test/round.test.ts`, `apps/api/test/pipeline-probe.test.ts`, `packages/core/test/scoring-day.test.ts`, plus the new rules/duel tests.
**Generate:** an additive migration for `rounds.rulesVersion`, default 1 for existing rows. New publication explicitly writes version 2 only when this complete task is deployed.

**Interfaces:**

```ts
export type RoundRulesVersion = 1 | 2;
export function ratingEligible(
  version: RoundRulesVersion,
  questions: Array<{id:string; outcome:"yes"|"no"|"void"|null}>,
  answeredIds: ReadonlySet<string>,
): boolean;
```

Extend `calculateDuel(qs, version: RoundRulesVersion = 1)`; version 1 retains all-five completion, version 2 uses `ratingEligible`. Persist and expose the round version in reveal/today/ledger aggregation inputs, with version 1 as the backward-compatible default.

- [ ] Before editing, trace every writer/reader of daily points, Oracle wins, multipliers, completed rounds, and eligibility. The same stored version must reach board, reveal, ledger recomputation, settlement, and share.
- [ ] Add a version matrix: v1 reproduces old results; v2 four answered plus one global void qualifies; four answered plus one ordinary miss does not; two scored questions never qualify; pending never qualifies. Assert the 50-rated-call gate still holds.
- [ ] Add the additive version migration. Do not rewrite old rounds or their multipliers. Test old payloads and old database rows explicitly.
- [ ] For v2 publication, prefer candidates whose outcomes remain unknown through the common lock. Do not weaken leak detection to obtain a full window; fallback content must meet the same timing promise.
- [ ] For v2 probe-triggered early closure, use the existing resolution/void path to globally void the question and retain the reason. Do not replace its text or re-open it. Ensure retries cannot double-settle or grant competitive credit for the void.
- [ ] Centralize v2 completion through `ratingEligible`; use it for the board, truth score, ledger progress, and duel. Recompute only the affected round/user state through existing retry-safe settlement. Voluntary skips remain ineligible.
- [ ] For v2, set streak and early-participation point multipliers to identity. Rank both players and Oracle using the shared base point calculation. Keep any contrarian credit separately labeled; never include it in competitive ranking. Preserve v1 score rendering exactly.
- [ ] Keep shield use/continuity behavior, but update its explanation, the rites, and reveal so no new-version surface promises multiplied points. Review purchased-benefit wording as part of gameplay honesty without changing billing or grants.
- [ ] Confirm v2 milestones count complete eligible rounds consistently; global voids must not create five rated calls from four outcomes. A majority-void day may acknowledge participation but cannot earn a completed-rated-round achievement.
- [ ] Run core tests and focused API settlement/ledger/round/probe tests, then full `pnpm test` and `pnpm typecheck`. If the API suite stalls, diagnose the first stalled test; do not claim it passed or silently omit it.
- [ ] Review the migration and v1/v2 fixtures before enabling new publication. Commit: `feat(game): version fair completion and remove attendance score multipliers`.

**Done:** Rule changes are prospective, comparisons are symmetrical, and a system-voided question cannot selectively penalize a player's skill record.

### Task 10: Two-session gameplay acceptance test

**Create:** `docs/gameplay/playtest-protocol.md`, `docs/gameplay/playtest-results.md`.
**Modify:** `apps/mobile/src/analytics/analytics.ts` and relevant first-play/reveal call sites only for the events below.

**Interfaces:** Add `practice_started`, `practice_completed`, `practice_skipped`, `first_live_seal`, `reveal_summary_viewed`, and `share_sheet_opened` to the existing event union. Event properties are primitive values: round date, rules version, elapsed milliseconds, duel status, and playable count. Do not collect participant free text in analytics.

- [ ] Define each event at a real transition; avoid duplicate firing on refetch/re-render. Keep practice completion separate from a live seal. Label share-sheet opening accurately; retain legacy analytics naming only where migration requires it.
- [ ] Write the uncoached session-one script: explain the premise in your own words; choose confidence; cancel a practice choice; complete the five; name the question whose answer you want to learn. Record confusion and accidental commitments without rescuing the participant immediately.
- [ ] Bring the same five participants back when results really exist. Ask who won, why, which call mattered, whether evidence was convincing, and what they want to do next. Include a missed-day and low-crowd walkthrough separately from genuine outcome anticipation.
- [ ] Record completion time, successful first seal, full-round completion, recalled question, correct duel interpretation, void confusion, and return intent. Use local/manual notes when analytics is unconfigured. No provider setup is a prerequisite.
- [ ] Use formative targets: at least 4/5 explain confidence, avoid an unintended first commitment, and recall a question; at least 4/5 interpret the result correctly. Report actual sample size and failures without claiming a retention uplift from five participants.
- [ ] Ask separately whether streak preservation remains desirable after the score changes. This is a product interview, not authorization to change Plus pricing or allowances.
- [ ] Document observed issues, the smallest corrective changes, and the next test. Do not mark a test completed without real participants. Run the relevant regression tests after corrections; perform final device checks for VoiceOver, large text, reduced motion, boundary times, missing forecasts, and void-heavy rounds.
- [ ] Commit the protocol and completed evidence when available: `docs(gameplay): record two-session gameplay validation`.

**Done:** Real players understand the game and its result, and the next iteration is based on observed behavior.

## Decisions to review before implementing the affected phase

The plan makes concrete recommendations so review is possible. These changes differ from earlier approved specs:

- The headline duel and v2 board use base confidence points instead of right-answer counts/asymmetric bonus totals.
- V2 early outcome discovery globally voids that question; answering every remaining non-void question with a three-question floor qualifies.
- V2 streak and first-hour multipliers become recognition only.
- The reveal chooses immediate results rather than a hidden final-card ceremony.

Review those decisions together before Task 9; avoid implementing a mixed rule set. Phase A can proceed independently once implementation is requested. There is no estimate promising all phases fit a fixed number of days: the native playtests and scoring migration are the main uncertainty.

## Completion checklist

- [ ] All ten recommendations have implemented deliverables or recorded playtest outcomes.
- [ ] First-time and returning navigation are both verified on device.
- [ ] No pre-seal forecast/crowd leak or accidental practice submission.
- [ ] Duel, board, ledger, and share agree for the same rules version.
- [ ] Legacy historical scores are unchanged.
- [ ] Early closure, pending, void, partial day, and missing forecast are honest and useful.
- [ ] The 50-call gate and unchanged crowd floors still hold.
- [ ] All required automated checks finish successfully; native experience verified separately.
- [ ] Remaining issues and participant evidence are recorded without fabricated results.
