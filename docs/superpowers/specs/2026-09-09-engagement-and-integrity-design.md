# ORACLE engagement and integrity design

**Date:** 2026-09-09
**Status:** Proposed design. Writing this document authorizes no application changes. It supersedes nothing in running code until an implementation plan is approved.
**Author context:** Follows the Sept 9 live-round audit. The first live round (2026-09-09, rules v2) exposed two mis-authored questions and confirmed that the daily loop, though well crafted, has an empty dopamine schedule between seal and verdict.

## Goal

Keep ORACLE's 24-hour answering window and its finished craft. Fix the two things the audit found wrong: **questions that cannot resolve honestly inside the window**, and **a result experience that arrives late, batched, and off-screen**. A player should seal today, feel small confirmations trickle in through the evening as questions resolve, and wake to a settled verdict with the next round already waiting.

## What is already true (do not rebuild)

- The pull-and-throw seal, the anti-herding crowd wall, the additive contrarian scoring, layout stability, and reduced-motion support are finished and good.
- `resolveQuestion` (`apps/api/src/resolution.ts`) resolves one question, snapshots the crowd, and scores every prediction. It is the single write path and is idempotent per status guard.
- The reveal endpoint (`apps/api/src/routes/round.ts` `/:date/reveal`) already serves partial and pending state, per-question `void_reason`, and `my` receipts.
- The hinge push composes once at settle (`apps/api/src/pipeline/actions.ts` `settle` → `composeHingePushes` → `sendPushes`). It is deterministic and idempotent by `userId+date` hash.
- Share output already carries a challenge line and a link: `shareMessage` (`apps/mobile/src/game/sharePattern.ts`) appends `can you outsee me?` and `SHARE_URL` (`apps/mobile/src/config/links.ts`, from `EXPO_PUBLIC_SHARE_URL`).
- Local reminders exist (`apps/mobile/src/notifications/schedule.ts` `resealReminders`, `apps/mobile/src/game/reminders.ts` `planReminders`) but fire at fixed offsets from the lock.

## Non-negotiable constraints

- iOS first; existing Expo/React Native and Hono/Workers/Drizzle stacks only. No new third-party services.
- No crowd, market, or Oracle probabilities before a player's answer is sealed.
- Confidence stays 55–95 in steps of 5. Oracle Score stays 50 rated calls over the latest 100.
- Rules changes apply prospectively under the stored round `rulesVersion`; v1 rounds keep their contract.
- Every server write stays idempotent: neon-http has no transactions, and the hourly cron re-dispatches. A retried tick must not double-send a push or double-score.
- Preserve real locks, evidence links, and explicit pending/void states. Never fabricate a player, a crowd, or an Oracle forecast.

## The clock decision

Keep noon-to-noon. The answering window is not the problem; the resolution window is. No copy, reminder, or test change for the clock itself. Instead, a selection rule forces most of a round to resolve the evening of the lock (Section 1).

---

## Section 1 — Pipeline integrity (`@oracle/api`, `@oracle/core`)

The Sept 9 round published a box-office question resolving Sunday (it would void unseen at the Friday deadline) and a weather question that was a ~90% YES because the next day's high is already forecast. Four fixes.

### 1.1 Void-deadline guard

**Problem.** Nothing rejects a question whose honest `resolves_at` falls after the round's void deadline. `lockFromResolvesAt` (`apps/api/src/pipeline/draft.ts`) clamps any late instant to the lock and discards the information, so a question that truly resolves Sunday looks fine at publish and then voids Friday noon (`apps/api/src/pipeline/state.ts` `voidDay = addDays(lockedDate, 2)`).

**Design.** Carry the true `resolves_at` instant through validation instead of clamping it away. In `upsertDraft` and the gauntlet's selection, reject any question whose `resolves_at` is `after-lock`-clamped past the void deadline, i.e. later than noon ET two days after the round date. `RESOLVES_AFTER_LOCK` remains legal (it means "resolves sometime after the lock, within the window"); a concrete instant past the deadline is rejected with a clear error.

### 1.2 Fast-round selection rule

**Problem.** A round settles only when its slowest question resolves. One Sunday question holds the whole verdict two days.

**Design.** A round must resolve fast:
- At least four of five questions must resolve **within `EVENING_RESOLVE_LAG` of the lock** (proposed 4 hours; a named constant in `@oracle/core/constants.ts`).
- Only the Big One (slot 5) may resolve later, and never past the void deadline.

Enforced in two places: the gauntlet's selection prefers and then requires a fast slate, and `upsertDraft` validates it for `rulesVersion >= 2` (alongside the existing "full common answering window" check). The authoring and gauntlet prompts (`apps/api/src/pipeline/author.ts`, `gauntlet/generate.ts`) are updated to state the rule so the model aims for it rather than being rejected after the fact.

### 1.3 Contestedness / forecast sanity

**Problem.** The weather question passed every window check yet was near-certain, because a forecast for tomorrow's high already exists today. Window rules cannot catch a question whose answer is *predictable*, only one whose answer already *exists*.

**Design.** Add a contestedness gate to the gauntlet's critic (`apps/api/src/pipeline/gauntlet/critic.ts`), which already returns a `critic_probability`. Reject a candidate whose critic probability is outside a contested band (proposed 0.30–0.70, matching the author-probability bound). For weather specifically, prefer thresholds set near the forecast midpoint rather than a round number a public forecast already answers. This is an editorial gate, not a truth claim; it removes lopsided questions, it does not adjust odds.

### 1.4 Honest question withdrawal

**Problem.** There is no way to strike a live question from a round with a truthful reason. The only removal paths are "you missed it" (a closed, unsealed slot shows a struck numeral) and the leak-heal path (`apps/api/src/pipeline/probe.ts`), whose mid-round banner is hardcoded to `EARLY ANSWER · VOID FOR EVERYONE` (`apps/mobile/src/app/round.tsx`). Neither fits "this question was mis-authored."

**Design.**
- Add a general withdrawal reason vocabulary to `@oracle/core` (e.g. `PIPELINE_LINES.withdrawnMisauthored`, `withdrawnUnresolvable`), distinct from the leak line.
- Add an admin action (`apps/api/src/routes/admin.ts`) that withdraws a question from a live round: sets `locksAt = now` and a general `withdrawnAt` marker, then voids via `resolveQuestion` with the chosen honest reason. Reuse the existing `lockHealedAt` column only if its semantics are widened; otherwise add a `withdrawnAt` column so leak-heal and editorial withdrawal stay distinguishable (they carry different reveal copy and different analytics meaning). **Decision: add a distinct `withdrawnAt` column.**
- Mobile: the mid-round banner reads the question's reason/marker rather than assuming leak. The v2 required-set filter (`apps/mobile/src/app/index.tsx`, `round.tsx`) drops a question that is either lock-healed **or** withdrawn, so the round still rates on the remaining questions (≥3 scored required).
- The reveal already renders `void_reason` verbatim, so a withdrawn question shows its honest reason there with no reveal change.

### 1.5 Today's live round

The 2026-09-09 round was a test with only the author's device predicting. No production mutation. The box-office question auto-voids at the Friday deadline; the weather question scores as an easy YES. The withdrawal mechanism (1.4) handles the next such case cleanly.

---

## Section 2 — Staggered results (the core dopamine fix)

Today, the only result push is one batch at settle. Change to a trickle: each question announces itself as it resolves, and home shows a locked round as live and partly decided.

### 2.1 Per-question resolution push

**Design.** When `resolveOne` (`apps/api/src/pipeline/resolve.ts`) resolves a question successfully, compose and send a single line to each player who answered it: outcome, their call, their points. Example: `THE 49ERS WON. YOU CALLED IT AT 75%. +38.`

- A new `composeResolutionPushes(db, questionId)` in `apps/api/src/push/compose.ts`, mirroring `composeHingePushes`: audience is the question's own predictors, aliases from `devices`, line selection deterministic by `userId+questionId` so a retried resolve composes the identical batch.
- **Idempotency.** A resolve can be retried by the hourly cron. Guard with a per-prediction `resolvePushedAt` marker (new nullable column on `predictions`, or a small `sent_pushes` ledger keyed by `userId+questionId`). **Decision: a `resolvePushedAt` column on `predictions`**, set in the same pass that scores the prediction, checked before send. Simpler than a ledger and colocated with the score it announces.
- The batched hinge push at settle stays, but its copy shifts from "here are your results" to closure and streak ("THE DAY IS WEIGHED. VIGIL OF FOUR."), since the results already arrived. Copy pools in `@oracle/core/copy.ts`.

### 2.2 Home "IN PLAY" state

**Design.** A locked-but-unsettled round the player answered shows on home as `IN PLAY · N DECIDED · M PENDING`, the decided questions tappable into the existing partial reveal. The reveal endpoint already returns per-question `outcome`; home reads it for the locked round the way it reads the settled one. No new endpoint; extend the home data hooks (`apps/mobile/src/app/index.tsx`) to fetch the in-play round's reveal and count decided vs pending.

---

## Section 3 — Surfacing and closure

### 3.1 Home "yesterday" = most recent settled round you played

**Problem.** Home derives "yesterday" as `roundDate − 1` (`yesterdayOf`, `apps/mobile/src/app/index.tsx`). Because a v2 round can settle up to two days after its date, the verdict can settle onto a date home never looks at, so it never surfaces there.

**Design.** Replace date arithmetic with "the most recent settled round in which this player has a scored call." Prefer a small server field or endpoint that returns the player's latest settled round date, so the client does not guess. The ledger CTA and the "read the ledger" surface key off that date.

### 3.2 Share deep link + challenge (verification + finish)

`shareMessage` already appends the challenge line and `SHARE_URL`. Finish it:
- Ensure `EXPO_PUBLIC_SHARE_URL` is set in EAS to a real link that opens the app (universal link or `oracle://` scheme), not a bare marketing URL.
- Show the link/handle on the rendered card image itself (`apps/mobile/src/ui/ShareCard.tsx`, `PlaqueShareCard.tsx`), not only in the share text, since screenshots lose the text.

---

## Section 4 — Two engagement wins

### 4.1 Crowd movement since your seal

**Design.** After a player seals, record the crowd split at seal time. On the round footer or the next return, show how the tide moved: `YOU STOOD AT 40% YES. THE TIDE HAS MOVED TO 55%.` Reads from the existing crowd endpoint (`/today/crowd`); the seal-time split can be stored client-side per question or read from a crowd snapshot. Respect the existing small-crowd floors — say nothing about the tide below the floor that the finale and footer already honor.

### 4.2 Habitual-hour reminders

**Design.** Record the local hour at which this device usually seals (a small rolling history in local storage). Offset the daily closing/return reminders toward that hour instead of the fixed lock-relative offsets in `planReminders`. Falls back to the current fixed schedule until enough history exists. No server or push-service change; purely local scheduling.

---

## Data changes

- `predictions.resolvePushedAt` (nullable timestamp) — idempotency for per-question resolution pushes.
- `questions.withdrawnAt` (nullable timestamp) — editorial withdrawal, distinct from `lockHealedAt`.
- Possibly a server read for "latest settled round for a user" (3.1) — may be a query, not a column.
- New constants in `@oracle/core/constants.ts`: `EVENING_RESOLVE_LAG`, contestedness band bounds.
- New copy pools in `@oracle/core/copy.ts`: resolution-push lines, closure hinge lines, withdrawal reasons, crowd-movement lines.

All migrations are additive and default existing rows to null / v1 behavior.

## Sequencing

- **Phase A — integrity (Section 1).** Nothing downstream is honest until questions are. Ship first, including the withdrawal mechanism.
- **Phase B — the schedule (Section 2 + 3.1).** The felt change: staggered pushes, in-play home, and the verdict surfacing where the player looks.
- **Phase C — polish (3.2, 4.1, 4.2).** Share-card link on the image, crowd movement, habitual-hour reminders.

Each phase is independently shippable, testable, and reversible. Phase A has no client dependency; Phase B needs a coordinated API + mobile release; Phase C is mostly mobile.

## Testing

- **Core:** contestedness band, fast-round validation, void-deadline math, withdrawal reason selection — pure functions, unit tests.
- **API:** `upsertDraft` rejects a late/lopsided/slow slate; `composeResolutionPushes` idempotency across a retried resolve; withdrawal admin action leaves the round rating on ≥3; `resolvePushedAt` prevents a double send. Tests never touch the network (existing injected `marketFetch`/`sourceFetch`/`claude` pattern).
- **Mobile:** in-play home counts; "yesterday" resolves to the latest settled played round; withdrawn-question banner reads the honest reason; habitual-hour fallback when history is thin. Existing Vitest + accessibility-tree conventions.
- **Manual:** one full live round on device once Phase B is deployed, watching the evening trickle and the morning surface.

## Scope boundaries

No friend systems, chat, user-created questions, extra daily rounds, cash prizes, feeds, or new monetization. No clock shift. No change to v1 rounds. Purchase-retry reliability and annual-shield allowance remain separate follow-ups.

## Open decisions folded in

- Clock: keep noon-to-noon, add the fast-round selection rule. (Decided.)
- Result dynamic: staggered, not an appointment reveal. (Decided.)
- Today's round: leave it. (Decided.)
- Extras: all four in scope (share link, crowd movement, habitual reminders, home "yesterday" fix). (Decided.)
- Withdrawal marker: a distinct `withdrawnAt` column, not overloaded `lockHealedAt`. (Decided, in this doc.)
- Resolution-push idempotency: a `resolvePushedAt` column on `predictions`. (Decided, in this doc.)
