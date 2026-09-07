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

The local simulator build installed, but macOS denied automated keystrokes at its deep-link confirmation. No gameplay interaction, VoiceOver, large-text, or native share-sheet checks are claimed as passed. These checks remain pending under the protocol.

## Human evidence

Participants: 0. Sessions: 0. Real candidate reviews: 0. No retention, engagement or monetization outcome is claimed. Complete the five-person protocol and the 15-candidate editorial review before claiming gameplay validation.

## Release boundary

The additive `0008_stormy_misty_knight.sql` migration is generated locally and has not been applied to a real database. Deploy the migration before the coordinated API/mobile release. New automated drafts use version 2; existing rows default to version 1. Recheck scheduled content and fallback-bank questions against the full-window promise before launch. No production publication, deployment, payment changes or subscription grants were performed.

The earlier purchase retry and annual shield allowance findings remain separate follow-up work, consistent with the gameplay-focused scope.
