# Gameplay implementation and validation

Implementation date: September 6, 2026. Branch: `codex/gameplay-experience`.

## Implemented

- Three-idea introduction with optional full rules and unscored practice using the shared pull/confidence calculations.
- Plain confidence labels and pre-seal Big One stakes.
- Immediate reveal summary, decisive-call evidence, shared confidence duel, optional detail and sharing.
- Factual first-week milestones, conservative single-round observations, personal receipts without a crowd, and welcoming missed-day copy.
- Editorial quality gate, accessible opener/Big One selection, and frozen optional neutral context.
- Prospective version 2 completion and scoring across settlement, reveal, board, ledger and share. Every non-void question must be answered, with at least three scored questions; pending rounds cannot rate. Early answer discovery globally voids the question. Attendance does not multiply competitive points. Existing version 1 records retain their scoring rules.
- Existing analytics extended for practice, first live seal, reveal summary and share-sheet invocation. An invocation is not evidence that someone actually shared.

## Validation evidence

Completed automated checks:

- `pnpm test`: 957 passed (core 136, mobile 315, API 506); 95 test files. API completed in 333.75 seconds.
- Final ledger/global-void retry regression run: 16 passed after the ledger eligibility refinement.
- Final mobile regression run: 315 passed after the last reveal and early-void copy changes.
- `pnpm typecheck`: all workspace packages passed after the final code changes.
- Expo iOS export: passed, producing a Hermes bundle at `/tmp/oracle-gameplay-export`.
- `git diff --check`: passed.

 The integration fixture uses five synthetic users to exercise the existing leaderboard floor; it does not create real players or alter production.

## iOS verification follow-up

Retried on iPhone 17 Pro simulator, iOS 26.5, after the user granted permissions. The development server initially listened only on IPv6; starting Metro with `NODE_OPTIONS=--dns-result-order=ipv4first` restored the simulator's IPv4 connection. All API data in this walkthrough was synthetic and local.

Verified on iOS:

- Home → three-idea introduction → practice; returning access through the full rites.
- Practice button seal and retry; the local fixture still returned zero predictions after sealing practice.
- The user reproduced a real defect: rightward practice pulls navigated back. Disabling swipe-back on practice and replacing its responder with native gesture handling allowed a practice receipt (`NO AT 65%`), confirmed by the user and the accessibility tree.
- The user then identified a fidelity issue: practice did not match the actual cards or percentage display. Practice now renders `OracleCard` and `ConvictionColumn` directly, including their animation, confidence steps, haptics, payoff and hold controls. Its local-only seal exits before prediction submission, live analytics or round-state writes. The shared-card button path was verified again on iOS with zero test predictions.
- Immediate result summary, decisive-call evidence text, confidence comparison, milestone, expanded details and low-crowd wording.
- Native share sheet opens with the generated PNG and dismisses successfully. Nothing was sent externally.
- Returning to yesterday's result remains available after its first viewing.

The synthetic fixture initially contained hand-entered rounded totals that differed from the shared scorer; the fixture was corrected. This walkthrough does not replace API integration tests.

Final follow-up checks: 315 mobile tests pass; mobile typecheck passes; iOS Hermes export passes at `/tmp/oracle-ios-verified-export`; `git diff --check` passes.

Evidence: [shared practice card](ios-verification/practice.png), [reveal](ios-verification/reveal.png), [native share sheet](ios-verification/share-sheet.png).

Still pending: final shared-card manual pull/center-cancel walkthrough, uninterrupted full live round, actual VoiceOver operation, large-text and reduced-motion passes, and native pending/missing-forecast/void-heavy scenarios. Automated drag delivery remained unreliable, so these are not claimed as passed. The shared-card code path and existing mechanics tests reduce duplication but do not replace these manual checks.

## Human evidence

Participants: 0. Sessions: 0. Real candidate reviews: 0. No retention, engagement or monetization outcome is claimed. Complete the five-person protocol and the 15-candidate editorial review before claiming gameplay validation.

## Release boundary

The additive `0008_stormy_misty_knight.sql` migration is generated locally and has not been applied to a real database. Deploy the migration before the coordinated API/mobile release. New automated drafts use version 2; existing rows default to version 1. Recheck scheduled content and fallback-bank questions against the full-window promise before launch. No production publication, deployment, payment changes or subscription grants were performed.

The earlier purchase retry and annual shield allowance findings remain separate follow-up work, consistent with the gameplay-focused scope.

## Practice reveal — September 6, 2026

Added a fixed fictional home-win reveal after a practice seal. Results reuse live payoff scoring, explain confidence and the opposite outcome, and retain the previous attempt for comparison on retry. Practice completion now fires when the result is opened. No prediction submission or score/streak mutation is introduced.

Verified on iPhone 17 Pro / iOS 26.5 with local synthetic API: hold-button YES at 55% → reveal +10; retry NO at 55% → reveal −10 and previous YES/+10 comparison. Pinned Return and retry controls remained visible. ASCII result decode retained. Higher-confidence payoff cases covered by tests; sustained hold and horizontal pull were not revalidated in this pass.

Validation: 317 mobile tests, mobile TypeScript check, and iOS export passed.

## Duel visual language — September 6, 2026

Completed current-rules duels now reuse the existing creation-hands-orb still: marble/player left, painted/Oracle right. Confidence points and right-answer counts sit under their corresponding hands, before the highlighted question. The exported share card repeats this pairing and states the winner/tie. Existing Home motion, question typography, and ASCII decode are unchanged; unavailable, pending, and legacy result handling remains intact.

Native verification with synthetic data: inspected the iOS result (player 127, Oracle −40, both 4/5 right), generated and inspected the share PNG, and dismissed sharing without sending it. Preview: `ios-verification/duel-share.png`. Mobile tests: 317 passed. TypeScript check passed. No new animation or downloaded asset was added.
