# Plan 4 Candidates

Captured 2026-08-27 from design conversation (Erik + Claude), while the Hermes pipeline was mid-build. These are candidates to spec via brainstorming when Plan 4 opens — not commitments.

## 1. Oracle Pools (Duolingo-style leagues) — the D7 lever

Weekly pools of ~10–30 players ranked by day points, with promotion/relegation between tiers, plus invite-based friend pools. The strongest known retention mechanic for a daily ritual, aimed squarely at the mid-September kill/continue gate (D7 ≥ 20%).

**Design commitments made in conversation:**
- **The shared round is sacred.** No interest-based personalization of the daily five — crowd %, against-the-tide, and the share card all depend on everyone facing the same questions (one word, like Wordle). Interests may shape *pool composition* (a sports-flavored pool trash-talks the same round), never content.
- Composes with existing identity layer for free: epithets and calibration verdicts give pools personality.
- Depends on: real identity beyond device tokens (usernames at minimum), a social graph table, invite links. Pairs naturally with the already-deferred **rivalries** (see `2026-08-26-costar-dynamics.md`, deferred to Plan 4).

## 2. User-proposed questions with AI feasibility gate + resolution

Players propose questions; Hermes resolves them with the machinery the pipeline already ships (verify-or-void, source-restricted web search, evidence receipts — it works on any well-formed question, not just Hermes-authored ones).

**Shape agreed in conversation:**
- Proposals land in a candidates table. At submission, Hermes runs a **feasibility gate**: can it name a source, exact resolution criteria, and a next-day deadline? Does it pass the authoring system prompt's forbidden-topics contract? Accept/reject in the machine voice.
- The nightly authoring job draws from accepted proposals before inventing its own.
- When a player's question runs: "THE ORACLE HEARD YOU" (push copy candidate — must go through the voice spec's copy-bank lint rules).
- Sequence after launch; moderation risk is real and the feasibility gate is the control.

## Standing Plan 4 preconditions already recorded elsewhere (context, not candidates)

- `settleRound` retry-safety (per-user `streak_settled_through`) before any further settlement automation — comment in `apps/api/src/settlement.ts`. Cloudflare Workflows or a plain DO alarm was evaluated (2026-08-27) and deferred: the DB-state-derived cron pipeline already provides the durability; exactly-once step semantics only become interesting when solving settle atomicity.
- The four push-trigger obligations in `apps/api/src/push/compose.ts`.
- A migrate-script workflow for Neon (0001 was applied by hand).
- Bounded audience queries in settlement.
- Rivalries (Co-Star research doc).
