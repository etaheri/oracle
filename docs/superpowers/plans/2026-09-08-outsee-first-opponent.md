# Outsee First Opponent Implementation Plan

> Copy refinement: `docs/gameplay/outsee-creative-gameplay-pass.md` supersedes the initial AI-opponent label and exact wording examples below. Mechanics and historical rules remain unchanged.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Outsee's identity clear, establish competition against both the Oracle and other players, and give every first or late arrival a compelling path into live play or an immediate exhibition.

**Architecture:** Reuse the existing home, first-launch rite, practice route, card gestures and reveal summary. Add pure arrival and comparison presenters plus a read-only historical exhibition endpoint; the existing scoring functions remain authoritative. Historical content gracefully falls back to a clearly fictional bundled example.

**Tech Stack:** Expo 57, React Native 0.86, React 19, Expo Router, TanStack Query, Hono, Drizzle, Zod, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-08-outsee-first-opponent-design.md`

## Execution status

Tasks 1–5 are implemented; focused reviews and automated checks are complete, including final entry-navigation remediation. Final independent review passed with no open findings. Task 6 automated integration and a native fixture walkthrough are complete. The full accessibility/device matrix, first-install native rebuild, five-person playtest and production metrics remain unverified; unchecked mixed verification steps below retain those outstanding portions. See `docs/gameplay/outsee-first-opponent-verification.md` for exact evidence and limits. Implementation is isolated on `codex/outsee-first-opponent`; external release is separate.

## Global Constraints

- Use Outsee as requested; current OUTSEEN site spelling is corrected.
- Preserve internal package names, bundle identifiers, URL schemes, persistence keys, backend identifiers and purchase product IDs.
- Live Oracle forecasts stay hidden until existing reveal rules allow them.
- Version 1 and version 2 rating rules stay unchanged.
- Exhibition does not submit predictions, update score/streak, earn live milestones, or trigger notification permission.
- Read `apps/mobile/AGENTS.md` and the exact Expo 57 documentation it requires before implementation.
- Keep the orb, existing design tokens, accessible controls, reduced-motion path and deep-link behavior. Do not introduce another visual system or dependencies.
- Each task receives focused verification; reviewed changes are batched into one integration commit. No deployment or external publishing is part of this plan.

## Existing behavior that matters

- `app.json` still names the app ORACLE; `MaterializeTitle.tsx` prints ORACLE, `BootRite.tsx` prints ORACLE OS, and the site says OUTSEEN.
- `CallingRite.tsx` is a separate, roughly 13-second first-install cinematic; changing BootRite alone misses first launch.
- `homeLines.ts` calls players oracles. `index.tsx` renders PLAY TODAY even when availability is zero and conflates a fetch failure with an absent round.
- `useToday` maps only 404 to null; preserve the difference between null and query error. `/today` disappears once the last lock passes, so next-round and exhibition actions cannot depend on a current round object.
- `practice.tsx` sends opening users directly to `/round`, even if it has closed. Existing practice has an immediate fictional result but no opponent.
- `calculateDuel` requires at least three scored questions. `oracleQuestionPoints` is the correct shared primitive for a one-question exhibition.
- `revealSummary.ts` already has win/loss/tie headlines and a largest-gap highlight. Extend those instead of rebuilding results.

## File responsibilities

| Files | Responsibility |
| --- | --- |
| `packages/core/src/copy.ts`, mobile identity components, site HTML | Brand and explanatory language |
| New `apps/mobile/src/game/arrivalState.ts` | Pure arrival state and action selection |
| New `apps/mobile/src/ui/HomeChallenge.tsx` | Compact home invitation/actions; leave orb choreography in home |
| New `packages/core/src/exhibition.ts` | Validated exhibition contract and single-question comparison |
| New `apps/api/src/exhibition.ts` | Historical selection and safe public projection |
| Existing API round router and mobile hooks | Read-only exhibition delivery |
| New `apps/mobile/src/game/exhibitionFallback.ts` | Clearly fictional offline content |
| Existing practice route/card/result module | Exhibition interaction and exit |
| New `apps/mobile/src/game/rivalryMoment.ts` | Truthful reveal explanation |
| Existing crowd presenter, round screen, analytics | Anticipation and measurement |

## Task 1: Establish the brand and shorten first contact

**Files:** Modify `apps/mobile/app.json`, `apps/mobile/src/ui/{MaterializeTitle,SystemHeader,BootRite,CallingRite}.tsx`, `apps/mobile/src/game/homeLines.ts`, `packages/core/src/copy.ts`, `apps/mobile/src/app/{rites,plus,ledger}.tsx`, `apps/site/public/{index,privacy,support}.html`. Inspect `apps/mobile/src/ui/ShareCard.tsx`, `apps/mobile/src/config/links.ts` and notification copy for visible branding without changing destinations or IDs.

**Interfaces:** Keep all component exports and persisted flags. `spokenLine(playerCount: number): string` continues accepting the actual player count.

- [x] Inventory visible identities with `rg -n 'ORACLE|Oracle|OUTSEEN|Outseen' apps/mobile/src apps/mobile/app.json apps/site/public packages/core/src/copy.ts`. Classify each match as app, opponent, rating, or internal identifier before editing.
- [x] Set display name to `Outsee`, main wordmark to `OUTSEE`, system header identity to `OUTSEE`; label the orb separately “THE ORACLE · Your AI opponent.” Set Plus UI to “Outsee Plus.” Use YOUR FORECAST RATING for the player and ORACLE RATING for the opponent, preserving API fields and calculations. See Task 1B for canonical vocabulary.
- [x] Update short first-launch copy and timers: three lines from the spec, 900ms beat, 450ms print, 800ms final hold; keep visible skip and static reduced-motion continue. Preserve `markBootDone`, `markOrbLanded` and one-time flag behavior. Returning boot uses `OUTSEE` / `THE ORACLE WAKES` / `YOUR NEXT CALL AWAITS`; essential copy does not depend on the animation.
- [x] Replace player-count copy with zero: “MAKE THE FIRST CALL”; one: “1 PLAYER HAS MADE A CALL”; plural: “N PLAYERS HAVE MADE THEIR CALLS.” This count means distinct participants, not completed rounds.
- [x] Put the three-step explanation in INTRO_LINES: “CHOOSE WHAT YOU THINK WILL HAPPEN.” / “SET HOW SURE YOU ARE. CONFIDENCE CHANGES YOUR POINTS.” / “RETURN TO SEE IF YOU BEAT THE ORACLE AND WHERE YOU RANK AGAINST OTHER PLAYERS.” Label reference navigation HOW TO PLAY and practice TRY AN EXHIBITION.
- [x] Rewrite the site around the spec's promise. Explain individual deadlines and results after verification; remove “Five questions. One a day,” rigid next-day guarantees, database implementation language and the sentence explaining why the website exists. Preserve factual TestFlight availability and support contacts.
- [ ] Run `pnpm --filter @oracle/mobile test -- test/homeLines.test.ts test/calling.test.ts test/bootGate.test.ts` and `pnpm --filter @oracle/core test -- test/copy-lint.test.ts`. Update assertions for deliberate vocabulary changes; preserve lint protections rather than disabling the suite. Inspect small-screen wordmark and first-launch layout. Commit this identity pass.

## Task 1B: Align every surface around purpose, record and optional streak

**Files:** Create `docs/gameplay/outsee-copy-inventory.md` and `packages/core/src/gameCopy.ts`; modify `packages/core/src/{copy,index}.ts`, `apps/mobile/src/app/{rites,ledger,plus,index,round,summons}.tsx`, `apps/mobile/src/app/reveal/[date].tsx`, `apps/mobile/src/game/{homeLines,scoreProgress,revealRows,reminders,shieldNotice}.ts`, `apps/mobile/src/notifications/schedule.ts`, `apps/mobile/src/ui/{ShareCard,ConfidenceHistory}.tsx`, `apps/api/src/push/compose.ts`, and site HTML. Trace other consumers from the inventory rather than assuming all strings live in core.

**Interfaces:** Export `GAME_TERMS` and `CURRENT_GAME_COPY` from gameCopy.ts. Preserve existing consumer exports while moving current terminology to the shared source. Archived rule copy stays explicitly versioned. Do not introduce a localization framework or rewrite historical scoring.

```ts
export const GAME_TERMS = {
  product: 'Outsee', opponent: 'The Oracle', players: 'players',
  rulesNav: 'How to play', rulesTitle: 'The Rites',
  history: 'Your ledger', streak: 'Streak', streakTitle: 'Your vigil',
  playerRating: 'Your forecast rating', opponentRating: 'Oracle rating',
} as const;
export const CURRENT_GAME_COPY = {
  purpose: 'Make your call. Outsee the Oracle. Outscore the field.',
  streakMeaning: 'Your streak marks your return, not your accuracy.',
  lapse: 'A new streak begins with your next call. Your predictions, results and rating remain.',
  shieldUsed: 'Your shield preserved your streak. No calls were added.',
} as const;
```

- [x] Build an inventory table with surface, source file/export, current wording, player question answered, replacement, eligibility/trigger and verification. Search shared copy plus hardcoded JSX, notification titles/bodies and push composer. Include error/empty states, full Rites, confidence help, score progress, Plus purchase/restore outcomes, shares and support. Identify externally configured campaigns separately.
- [x] Rewrite the full Rites in the spec's six sections, with purpose first. Keep the short introduction separate. Explicitly introduce competing against the Oracle and other players, distinguishing DAILY BOARD rankings from THE CROWD percentages. Teach one-call streak participation versus complete eligible-round rating; show when settlement updates a streak. Explain fifty qualifying calls as cumulative, not consecutive. Do not use the historical “all five” rule for current voided questions.
- [x] Implement current rule copy as explicit data rather than `.map` substring substitutions on legacy sentences. Use rules_version only where historical behavior is being described. Remove the Plus component's string-equality substitution for the obsolete multiplier creed after it consumes current shared copy.
- [x] Apply canonical labels and explanatory subtitles to ledger, home notices, reference navigation and share context. Replace “unbroken noons” and “consecutive days played” claims where shields make them untrue. Rename only displayed rating labels, never persisted/API identifiers. Keep daily results, long-term forecasting skill and streak recognition visually and verbally distinct.
- [x] Update streak details with the verified current rule: one sealed daily call qualifies participation; settlement advances the count; a shield preserves but does not increment it. Keep lapse welcoming, results intact and exhibition excluded. Do not claim accuracy improves merely from attendance.
- [x] Rewrite Plus around optional protection, current eligibility and actual entitlement limits. Derive numeric statements from constants where practical. Active subscription alone must not yield “your streak is protected” without eligible reserve state. Use readable MONTH/YEAR labels and preserve store-provided prices, purchase terms and current product identifiers.
- [x] Rewrite generic scheduled reminders to avoid unsupported claims about results, exact future deadlines or crowd activity. Keep server-verified result wording separate. Notification sender is Outsee. Preserve scheduling/permission policy. Audit local copy pool eligibility as well as push `requires` predicates; a poetic factual assertion still needs supporting data.
- [x] Add meaningful regression cases to existing `packages/core/test/{copy-lint,copy-select,streak}.test.ts`, `apps/mobile/test/{reminders,homeLines,shieldNotice,scoreProgress}.test.ts` and `apps/api/test/compose.test.ts`: unverified local reminder does not declare results ready; partial participation can maintain streak without earning a ranked duel; protected gap does not become a played day; current copy does not promise a multiplier; archived rules remain available; empty crowd does not produce social proof. Avoid snapshots of every sentence. Modify voice lint only where its policy conflicts with the approved plain-language instruction layer, keeping ambient copy checks intact.
- [ ] Run `pnpm --filter @oracle/core test`, `pnpm --filter @oracle/mobile test -- test/reminders.test.ts test/homeLines.test.ts test/shieldNotice.test.ts test/scoreProgress.test.ts` and `pnpm --filter @oracle/api test -- test/compose.test.ts`. Review the inventory end-to-end as a novice's journey; record each covered surface. Commit the copy consistency pass.

## Task 2: Make arrival state authoritative and actionable

**Files:** Create `apps/mobile/src/game/arrivalState.ts`, `apps/mobile/test/arrivalState.test.ts`, `apps/mobile/src/ui/HomeChallenge.tsx`; modify `apps/mobile/src/app/index.tsx`, `apps/mobile/src/ui/OracleClock.tsx`, `apps/mobile/src/game/roundAvailability.ts` only if its existing contract needs a small additive field, and `apps/mobile/test/roundAvailability.test.ts`.

**Interfaces:** Add the following pure interface, independent of query/router components:

```ts
export type ArrivalInput = {
  loading: boolean; failed: boolean; hydrated: boolean;
  hasRound: boolean; openCount: number; missedCount: number;
  allSubmitted: boolean; firstVisit: boolean;
  nextOpensAt: string | null;
};
export type ArrivalState = {
  kind: 'loading' | 'error' | 'live' | 'partial' | 'submitted' | 'waiting';
  primary: 'retry' | 'live' | 'crowd' | 'exhibition' | null;
  label: string | null;
};
export function arrivalState(input: ArrivalInput): ArrivalState;
```

Priority: failed → error; loading or incomplete hydration → loading; allSubmitted with a round → submitted; positive openCount → partial if missedCount positive, otherwise live; everything else → waiting. Unknown next opening changes supporting copy, not action. Missing question data must never be interpreted as allSubmitted.

- [x] Add behavioral cases before implementation, including:

```ts
const ready = { loading: false, failed: false, hydrated: true,
  hasRound: true, openCount: 5, missedCount: 0, allSubmitted: false,
  firstVisit: true, nextOpensAt: null };
expect(arrivalState(ready).label).toBe('MAKE YOUR FIRST CALL');
expect(arrivalState({ ...ready, openCount: 0 }).primary).toBe('exhibition');
expect(arrivalState({ ...ready, failed: true }).primary).toBe('retry');
expect(arrivalState({ ...ready, hydrated: false }).primary).toBe(null);
expect(arrivalState({ ...ready, openCount: 2, missedCount: 3 }).kind).toBe('partial');
```

- [x] Run `pnpm --filter @oracle/mobile test -- test/arrivalState.test.ts` and confirm new cases fail before implementing the selector.
- [x] Implement labels: retry RETRY; partial ANSWER REMAINING QUESTIONS; returning live PLAY TODAY; submitted SEE THE CROWD; waiting CHALLENGE THE ORACLE. HomeChallenge renders actions with callbacks and supporting copy, rather than embedding router or API access.
- [x] Keep static home orientation visible to both new and returning players: “A daily prediction game” and “Compete against the Oracle and other players.” Position compact supporting copy with identity/challenge so timing and main action remain prominent. Keep How to play accessible from home and ledger; label deep-linked results without an introduction overlay. Do not reset flags or force existing players through onboarding.
- [x] Connect current availability, persisted onboarding flags and server answer hydration. Inspect `useHydratePlayedState.ts` and expose readiness if necessary; do not infer readiness from an empty local answers object. Hold first-visit-dependent routing until flag read completes.
- [x] In index, preserve personal-result access but only let a result with actual personal answers displace live play. Spectator yesterday remains secondary. Use next opening in local time when known; absent schedule says “The next round hasn't been announced.” Errors show retry plus exhibition.
- [x] Remove “THIS DAY CANNOT RATE” from provisional live state. Explain all non-void questions are required and calls still receive results. Preserve healed/void semantics and legacy eligibility.
- [x] Drive clock labels from round timing: NEXT QUESTION CLOSES IN / NEXT ROUND OPENS IN; do not promise settlement at lock. Invalidate/refetch today and next at deadline transition and on app foreground; avoid a zero-countdown loop. Re-evaluate live entry at press time, then route to rites/round or exhibition using current state.
- [ ] Verify focused arrival and availability tests, typecheck mobile, and manually check first open during loading, restored answers, partial, all closed, null schedule and network failure. Commit.

## Task 3: Supply a truthful exhibition and comparison

**Files:** Create `packages/core/src/exhibition.ts`, `packages/core/test/exhibition.test.ts`, `apps/api/src/exhibition.ts`, `apps/api/test/exhibition.test.ts`, `apps/mobile/src/game/exhibitionFallback.ts`; modify `packages/core/src/index.ts`, `apps/api/src/routes/round.ts`, `apps/mobile/src/api/hooks.ts`.

**Interfaces:** Export `ExhibitionSchema`, inferred `Exhibition`, and `compareExhibition(prediction, exhibition)` from core. Shape:

```ts
// Zod validates the corresponding object, probability 0..1 and nonempty text.
type Exhibition = {
  id: string; kind: 'historical' | 'fictional';
  question: string; context: string; sourceName: string;
  roundDate: string | null; oraclePYes: number;
  outcome: 'yes' | 'no';
};
// prediction: { answer: boolean; confidence: number }
// result: { youPoints: number; oraclePoints: number;
//           winner: 'you' | 'oracle' | 'tie' }
```

`GET /v1/round/exhibition` uses existing device authentication and returns a validated historical Exhibition, or 404 if no qualifying example. `useExhibition(enabled: boolean)` uses query key `['exhibition']`, 60-second stale time and no repeated retries; 404 maps to null, other errors remain observable. UI supplies the fictional fallback for null/error. Place static route before parameterized round routes.

- [x] Write comparison cases for win, loss, tie, Oracle abstention, both outcomes and same answer/different confidence. Use the shared formula as the expected numeric source:

```ts
const p = { answer: true, confidence: 70 };
const e = { id: 'sample', kind: 'fictional' as const, question: 'Draw blue?',
  context: '7 blue, 3 amber', sourceName: 'Fictional example', roundDate: null,
  oraclePYes: .7, outcome: 'yes' as const };
expect(compareExhibition(p, e).winner).toBe('tie');
expect(compareExhibition(p, e).youPoints).toBe(
  oracleQuestionPoints({ pYes: .7, outcome: 'yes', isBigOne: false }));
```

- [x] Implement both participants' points via oracleQuestionPoints with isBigOne false; do not invoke calculateDuel or add an eligibility exception. Validate confidence with the existing allowed input bounds. Export the contract from core.
- [ ] Implement `selectExhibition(db: Db): Promise<Exhibition | null>` in the API module. Inspect existing schema/status names and test DB fixture helpers before writing queries. Select from the most recent 30 fully settled rounds, descending date then ascending slot. Require nonempty original context, valid recorded Oracle probability, verified yes/no outcome, and no void/healed question. Return the first eligible record with a minimal public projection. Never return another player's prediction, identity or live forecast. Do not claim commitment verification beyond what stored records establish.
- [x] Add route tests using existing DB helpers: eligible settled example; latest ineligible then older eligible; pending/live excluded; missing context/forecast excluded; 0.5 probability accepted; deterministic choice; empty database returns 404; no mutations to predictions or user ledger. Run `pnpm --filter @oracle/api test -- test/exhibition.test.ts`.
- [x] Create the spec's marble fallback with a fixed ID `fictional-marble-v1`, explicit fictional source/context, probability .70 and outcome yes. It works offline and never changes to reward the user's selection.
- [ ] Add the mobile hook and verify `pnpm --filter @oracle/core test -- test/exhibition.test.ts` plus API/core/mobile typechecks. Commit.

## Task 4: Turn practice into the first opponent encounter

**Files:** Modify `apps/mobile/src/app/practice.tsx`, `apps/mobile/src/ui/PracticeCard.tsx`, `apps/mobile/src/game/practiceResult.ts`, `apps/mobile/src/app/rites.tsx`, `apps/mobile/src/api/flags.ts` only as needed; extend `apps/mobile/test/practiceResult.test.ts` and add `apps/mobile/test/exhibitionFlow.test.ts` with a pure flow helper in `apps/mobile/src/game/exhibitionFlow.ts`.

**Interfaces:** `PracticeCard` accepts `exhibition: Exhibition` and `onCompleted: () => void`. `exhibitionPhase` transitions `choosing → sealed → revealed`; selection and reveal are explicit actions. The route freezes one example per attempt once displayed; network responses cannot replace a question under the player's hand.

- [x] Add tests that reveal cannot precede sealing, retry keeps the same outcome/Oracle forecast, completion is once per route session, and a closed live round produces a waiting exit rather than /round. Run the new tests before implementing the flow helper.
- [ ] Show context before commitment, with PAST ROUND · UNRANKED or FICTIONAL · UNRANKED. Reuse OracleCard's practice callback and gestures. Keep real forecast/outcome absent from rendered and accessible children until reveal. Use stable sample IDs without placing them in live roundStore.
- [x] On seal show “Your call is sealed.” and REVEAL THE RESULT. On reveal show both calls/confidence, actual outcome, both base points, then “You outscored the Oracle in this exhibition” / Oracle equivalent / tie. Fictional mode says “Example Oracle forecast”; the fictional win is never presented as beating the live model.
- [x] Show one concise confidence explanation using compareExhibition; keep the existing counterfactual learning aid where useful. Same-side confidence wins must not imply an answer disagreement. Oracle 0.5 is an abstention.
- [x] Replace unconditional opening BEGIN exit with arrivalState-derived PLAY TODAY / ANSWER REMAINING QUESTIONS / RETURN HOME. Refresh current data at exit; a deadline passing during practice cannot route into an empty round. Keep skip/return available and preserve existing practice-seen semantics without triggering first_live_seal or summons.
- [x] Keep an obvious “Try the same example again” secondary action. Existing users can reach exhibitions from home while waiting and from HOW TO PLAY anytime.
- [ ] Verify core comparison, practice and flow tests, mobile typecheck, and simulator interaction with network unavailable, fresh responses arriving mid-attempt, large text, VoiceOver, reduced motion and button-input alternative. Commit.

## Task 5: Make anticipation and results tell the rivalry accurately

**Files:** Create `apps/mobile/src/game/rivalryMoment.ts`, `apps/mobile/test/rivalryMoment.test.ts`; modify `apps/mobile/src/game/revealSummary.ts`, `apps/mobile/src/game/dailyBoard.ts`, `apps/mobile/test/dailyBoard.test.ts`, `apps/mobile/src/app/reveal/[date].tsx`, `apps/mobile/src/app/round.tsx`, `apps/mobile/src/game/crowdVerdict.ts` or add `crowdAnticipation.ts` with its focused test.

**Interfaces:** `rivalryMoment(questions: DuelQuestion[], duel: DuelResult): { questionId: string; kind: 'opposite_calls' | 'confidence' | 'abstention'; line: string } | null`. Only complete duels qualify. Select the existing `duel.highlightId`; keep overall winner independent of question-level narration.

- [x] Write behavioral cases for same-side confidence gap, opposite calls with either winner, Oracle abstention, zero-gap tie, void/pending/missing data, and a highlighted question favoring the loser of the overall round. The last case must not produce an overall-victory claim.
- [x] Implement per-question comparison with oracleQuestionPoints and oracleCall. Use “You saw what the Oracle missed” only when the player called the outcome correctly and the Oracle called the opposite; use a neutral “Your confidence made the difference on this call” for same-side nonzero gaps. Zero gap yields no rivalry moment. Caption the card “LARGEST POINTS GAP,” not “THE DECIDING CALL.”
- [x] Insert the short explanation under the existing overall duel summary, linking/focusing its question. Pair the Oracle outcome with the existing daily placing and a visible VIEW DAILY BOARD action near the top of results. Preserve source evidence, share eligibility and all pending/incomplete fallbacks. Do not add a second competing result headline.
- [x] Use API rank/field size and existing tie/small-field rules without client re-ranking. The API field_size, your_rank and minimum-field threshold count human players; label rank as among players, with the Oracle displayed for comparison. Do not add the Oracle to the denominator or re-rank client-side. Replace the hardcoded all-five ineligibility line in dailyBoard.ts with rules-version-aware copy. Ensure the fifty-call long-term rating threshold is never described as a prerequisite for daily competition. Add dailyBoard tests for ties, sparse field, Oracle inclusion, and current void versus legacy eligibility; verify against existing API board tests without changing rank policy.
- [x] At exhibition completion explain “The daily round also ranks you against other players.” Keep this subordinate to the context-aware next action and explicit that practice is unranked.
- [x] Summarize current crowd minority calls among sealed questions with valid returned crowd data. Reuse the existing display threshold; do not equate minority membership with bounty eligibility. Exactly 50% yields no disagreement, tiny crowds stay neutral, and missing answers are never compared. Display the dynamic wording from the spec.
- [ ] Run `pnpm --filter @oracle/mobile test -- test/rivalryMoment.test.ts test/revealSummary.test.ts test/crowdVerdict.test.ts test/dailyBoard.test.ts` plus the new crowd summary test; inspect both a win and loss reveal. Commit.


## Task 6: Verify comprehension and appeal for new and existing players

**Files:** Modify `apps/mobile/src/analytics/analytics.ts` and event call sites in index/practice/round/reveal; create `docs/gameplay/outsee-first-opponent-verification.md`.

**Interfaces:** Preserve existing practice/first_live_seal/reveal_summary_viewed events. Add `arrival_viewed` with `state`, `first_visit`, `has_schedule`; attach `entry_point` (`first_round`, `waiting_home`, `how_to_play`), `content_kind`, and `example_id` to practice events. Do not include device tokens, free text, or forecast payloads. Arrival emits once per meaningful state transition, not per countdown tick.

- [x] Record the entry point in practice route params and validate against the allowlist. Existing event semantics remain comparable; practice_completed still means explicit reveal, not simply entering the route. Mark completion before navigation so route cleanup cannot also emit skipped.
- [x] Instrument distinct arrival states, exhibition start/reveal/exit, first live seal and first result return. Preserve existing one-time guards and avoid duplicating existing first_live_seal capture. Document funnel segmentation by arrival state rather than combining waiting and live users.
- [x] Run `pnpm typecheck` and `pnpm test` once after all changes; fix regressions. Do not run production migrations or deployment. Record actual commands and outcomes in the verification document.
- [ ] Exercise the following matrix on iOS simulator and web if supported: new versus returning user; full/partial/closed/no-schedule; offline and retry; loading flags/answer hydration; deadline during practice; early global void; pending/insufficient/incomplete/no-Oracle results; tie and confidence win; deep-link reveal; reduced motion; screen reader; large text. Capture screenshots of first contact, waiting home, exhibition context/result and final rivalry reveal.
- [ ] Run a small formative playtest with five unfamiliar users when participants are available: ask “What is Outsee?”, “Who is the Oracle?”, “What can you do now?”, and “What changes when you increase confidence?” Also ask “Who are you competing against?” and ask participants to find both their Oracle result and daily board position. Distinguish the board from crowd opinion. Ask “What does a streak mean?”, “What happens if you miss a day?” and “What does a shield protect?” Check that players do not confuse streak with skill or a paid advantage. Observe first action without coaching. Target four of five independently distinguishing the roles and finding a valid action. Record observed outcomes; participant availability is a playtest dependency, not a reason to invent results or block code verification.
- [ ] Repeat the comprehension walkthrough with existing-player fixtures: introduction already seen, existing predictions/rating, protected streak and a return after a gap. Verify what/why/next action are understandable without a first-launch sequence. With available returning participants, ask what changed and whether both competitions and the next payoff are clear. Record cohort separately from novices.
- [ ] Validate the spec’s nine-question experience matrix against real screens and record screen/copy evidence for every row. Ask playtesters which moment made them curious, what they want to find out, and why they would return; record weak appeal even if they understand the rules. Do not substitute event completion for demonstrated enjoyment.
- [ ] Review completion and return metrics after actual usage exists. Treat better comprehension as a testable hypothesis, not a demonstrated retention lift. Commit final integration and verification notes.

## Dependency order and release boundary

Tasks 1 and 3 are independent. Task 1B follows identity work and supplies canonical copy to Tasks 2, 4 and 5; complete it before the final integration review. Task 2 establishes shared arrival behavior; Task 4 consumes Tasks 2 and 3. Task 5 can proceed independently of exhibition once its interface is understood. Task 6 integrates the whole experience. Ship the coherent experience together after verification; external release is a separate action.

## Plan self-review

- Brand separation and both startup paths: Task 1.
- App-wide purpose, Rites, streak meaning, rating labels, Plus and notification truth: Task 1B.
- Missed timing, error states, hydration and honest eligibility: Task 2.
- Historical authenticity, deterministic fallback and equal scoring: Task 3.
- Playable introduction, immediate payoff and safe return to live: Task 4.
- Competition against both Oracle and other players, visible daily board, crowd anticipation and grounded reveal explanation: Task 5.
- Persistent orientation for new, upgraded, returning and deep-linked users: Tasks 1B and 2.
- What/why/action/fun/return/record/streak/missed-timing acceptance matrix, accessibility and regression coverage: Task 6.
- No scoring changes, live forecast leaks, forced tutorial, manufactured win or persistence migration are required.
