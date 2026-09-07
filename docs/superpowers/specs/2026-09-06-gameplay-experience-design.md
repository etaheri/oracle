# ORACLE gameplay experience design

**Date:** 2026-09-06
**Status:** Proposed design for the requested gameplay plan. Writing this document does not authorize application changes or supersede the earlier game rules in running code.
**Context:** The user wants all ten gameplay recommendations developed into a plan. Submission logistics, provider configuration, and purchase infrastructure are outside this work.

## Goal

A newcomer understands and completes a round, remembers a prediction they care about, enjoys finding out what happened, and wants another attempt. Preserve ORACLE's distinctive voice and tactile character while reducing the work required to understand it.

## Product choices proposed by this plan

1. Teach three essentials before play: five daily questions, answer plus confidence, return for results. Teach other rules when relevant.
2. Offer one optional, unscored practice interaction using the same gesture mechanics as live play. No practice prediction reaches the API.
3. Keep confidence at 55–95 in steps of 5. Keep the payoff preview. Never label 95% certain.
4. Define the headline Oracle duel by identical base Brier-derived points for both participants, including the Big One's double weight, excluding crowd, timing, and streak bonuses. Correct-answer counts are secondary.
5. Use an immediate-results reveal: show the result without forcing five taps or concealing data, then the decisive question, comparison, progression, and optional details. No artificial suspense after the result is already known.
6. Evaluate questions for accessibility, reasonability, and interest as well as integrity. Establish the editorial rubric with human review before automating it.
7. Prefer questions that remain open for the advertised common window. Unexpected early closure is a global question exception, not a player penalty. This requires an explicit new rules version, described below.
8. Keep the 50-rated-call threshold and 100-call score window. Reward factual achievements before that threshold, without inventing skill estimates.
9. Under the new rules version, streaks and first-hour participation are recognition only; they no longer multiply points or losses. Shields preserve streak continuity. Purchasable benefits do not affect competitive scores.
10. Make the Oracle and the player's own receipt sufficient at low participation. A returning player can play today without first navigating an absence reprimand or purchase offer.

## Non-negotiable constraints

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

## First-round experience

Suggested opening copy: “FIVE QUESTIONS ABOUT TOMORROW. CHOOSE YOUR ANSWER AND HOW SURE YOU ARE. RETURN TO SEE WHETHER YOU BEAT THE ORACLE.”

Show a short `PRACTICE THE PULL` option and a direct `BEGIN` option. Full rites remain accessible. Existing players bypass this new opening; the persisted rites flag remains meaningful. Practice can be reopened from the rites screen.

Practice is a labeled mechanics exercise: “PRACTICE · NOTHING IS RECORDED”, with a neutral instruction to choose either side. Pull, adjust, return toward center to cancel, or release to see a sample receipt. Permit repetition or immediate exit. Use the same pure gesture/hold calculations and visual confidence control as live play. Do not create a fake real-world forecast or an instant graded question.

Plain confidence labels: 55 slightly leaning; 60 leaning; 65 somewhat confident; 70 fairly confident; 75 confident; 80 very confident; 85 strongly confident; 90 highly confident; 95 almost certain. The percentage is primary; atmospheric wording is optional secondary copy. The payoff remains visible while choosing.

The Big One announces double points in both directions before commitment. After five seals, the receipt explains when results are expected and shows the player's calls even when the crowd is too small. Full-rating requirements are explained at completion/eligibility surfaces, not as a long opening lecture.

## Competitive contract

Use a pure shared duel calculator. For each eligible question, calculate both participants' base points with the same Brier formula, Big One weight, and rounding. Never derive duel points from stored player points, which can include a contrarian bonus.

A duel requires the round to be fully resolved, the player to have answered every non-void question, at least three non-void questions, and a valid Oracle probability for every non-void question. Missing forecasts produce “NO COMPLETE ORACLE FORECAST”; no win, loss, or tie is awarded. A 0.5 forecast is a legitimate probability and earns zero base points; secondary counts show it as no directional call. Numeric strings from database values must be normalized before calling the calculator.

Compare summed integer points. Equal sums are a tie. Correct counts always carry coverage information. A mismatch between correct count and duel outcome is explained by the largest confidence-based difference: e.g. “YOU HAD MORE RIGHT ANSWERS. THE HIGH-CONFIDENCE MISS COST MORE.” Only show this explanation when the facts support it.

Reveal, ledger rivalry totals, and share cards must use this same calculator and eligibility contract. Under the new rules version, the board also ranks identical base points, so the Oracle does not occupy an asymmetrically scored ladder. Any retained contrarian credit is separately labeled and cannot affect duel or board rank. Clearly distinguish it from the competitive result; retire the bonus later only through a separate decision.

## Reveal and progression

Use immediate results, with this reading order:

1. Daily result: duel win/loss/tie if eligible; otherwise factual player outcome and coverage.
2. Decisive question: greatest absolute base-point gap in a valid duel; otherwise greatest absolute player base-point contribution. Break equal magnitudes by slot order. Call it a highlight, not “decisive”, when the result was a tie.
3. Comparison explanation and receipt: answer, confidence, actual outcome, points, and accessible evidence.
4. One earned milestone or factual observation.
5. Share action, then expandable question details and board. The Big One is always accessible in details, even when another question decided the duel.

Pending questions permit partial factual receipts but no final total, victory, or final-result share. Voids display a reason and never resemble wrong answers. Keep the initial summary short and let readers inspect the complete record.

Milestones are first completed round, first fully resolved completed round, first valid Oracle victory, three completed rounds on distinct dates, and seven completed rounds on distinct dates. Week-one milestones do not require an unbroken streak. Show at most one per visit in that priority order, and retain earned achievements in the ledger. Use server-derived facts; local storage controls repeated animation only. No milestone grants points or changes skill.

One possible learning observation is “YOUR MOST CONFIDENT CALL WAS WRONG”; show only with an unambiguous highest-confidence scored call that was wrong. Do not generalize to “you are overconfident” from one round. Defer category skill profiles until there is meaningful evidence.

## Question composition

Review at least 15 candidate questions and three five-question rounds manually. Score each 0–2 on understandability, a plausible reason to choose either side, and desire to learn the outcome. A zero in any dimension means rewrite or replace. The rubric is an editorial heuristic, not a probability estimate.

Prefer an accessible opener, varied middle questions, and a recognizable, consequential Big One. Current selection chooses the most contested candidate as the Big One; uncertainty alone will no longer determine that role. Preserve category diversity, deduplication, source checks, timing checks, and taste rejection. Never compensate for a failed integrity check with a high entertainment score.

Where context is necessary, use at most 240 characters of factual context with an as-of timestamp and a source. No bookmaker probabilities, consensus probabilities, Oracle beliefs, or instructions to choose a side. Context is verified and frozen at publish. It must not refresh after the player seals or contain the later outcome. Older rounds simply have no context.

Automate editorial annotation only after the human rubric produces useful examples. A pipeline failure must use already validated fallback content or explain unavailability; it must not publish an unverified question.

## Availability and fair completion

First ship accurate availability messaging without changing scoring: show earliest closing time, individual countdowns, remaining playable count, and whether the full rated round is still attainable. Render local time with an explicit New York reference where the daily schedule is explained. Do not promise instant results at noon when resolution remains pending.

For the prospective rules version, choose questions with expected information availability after the common lock. If the probe finds the outcome became available early, close and globally void that question for this version. All players receive the same void; prior answers on it earn no competitive points or rated call. Eligibility requires answering every remaining non-void question, with at least three scored questions. A voluntary miss on a non-void question still makes the day ineligible. A majority-void day has factual receipts and participation recognition, but no rated day, board placement, or duel.

Apply that rule consistently in settlement, ledger recomputation, board, reveal, duel, and share eligibility. Do not simply allow users to rate whichever subset they answered. Legacy rounds retain their prior completion contract.

## Streaks and return experience

Store the rules version on each round. Legacy rounds preserve their existing multipliers and displays. New rounds have no streak/first-hour point multiplier; streak milestones and early-participation badges remain factual recognition. Retain shield consumption and continuity rules unless a separate economy change is approved. Update the rites, payoff explanation, reveal, and shield value copy so none promises a score effect.

Home gives today's round an immediate action. Yesterday's unread result can remain prominent with a direct “PLAY TODAY” alongside it. Missed days do not block navigation. Old predictions, milestones, and skill record survive a streak break.

With 0, 1, 4, or 5 participants, personal receipts and valid Oracle comparisons still render fully. Existing privacy/statistical floors remain unchanged; unavailable crowd/board statistics become one optional status line rather than repeated empty placeholders. If the Oracle also failed, show the player's real result and an honest unavailability explanation.

## Validation and sequencing

Phase A: opening, practice, confidence, accurate availability. Phase B: shared duel, reveal, milestones, return/low-crowd experience. Phase C: editorial composition and prospective rules changes. Manual editorial review starts during Phase A.

Observe five new players without coaching. As a formative gate, at least four should explain confidence, complete the first interaction without accidental commitment, and name a prediction they want resolved. These are usability targets, not statistically reliable growth claims. Bring the same players back for results; ask who won, why, and what they want to do next.

Instrument first-play timing, practice completion/skip, seal failures, full-round completion, eligibility losses due to closure, result return, valid duel coverage, and share-sheet opening. Use existing analytics if configured; otherwise record the playtest manually. An opened share sheet is not proof that a card was posted.

## Scope boundaries

This plan does not add friend systems, chat, user-created questions, extra daily rounds, cash prizes, personalized feeds, deep premium stats, or new monetization. Purchase retry reliability and annual shield allowances remain separate follow-ups from the earlier review. No product code changes occur while creating this plan.
