# ORACLE — Standing, Immediacy, and the Question Lifecycle

**Date:** 2026-09-03 (27 days to Shipaton deadline; App Store submission targeted this week)
**Status:** design approved in chat 2026-09-03. Supersedes nothing; extends `2026-09-02-end-to-end-flow-audit.md`.
**Baseline:** `main` @ `79e2a33`. 619+ tests green across core / mobile / api.

---

## 0. What this is

Five changes, in one spec because they share a single thesis: **the app's honesty guarantees are load-bearing, and three of them are currently one small step from breaking.**

1. **`FIRST_HOUR_BONUS` is one percentage point from making overconfidence pay.** Fix the shape, not the value.
2. **There is no immediate feedback loop.** Add a daily board that works on install day.
3. **The standing line overclaims its own precision.** Band it.
4. **The evergreen bank is a finite buffer nothing refills.** Refill it.
5. **Nothing measures whether the questions were actually contested.** Measure it.

(1), (3) and (5) are honesty fixes. (2) is the stickiness feature. (4) is an ops guarantee that is currently only half-true.

---

## 1. The evidence behind the design

Two measurements drove the shape of this spec. Both are reproducible; the scripts are throwaway but the numbers are not.

### 1.1 The first-hour bonus is 0.01 from breaking properness

`scoring.ts:dayPoints` applies the bonus **only to positive day totals**:

```ts
if (!firstHour || sum <= 0) return sum;
return sum + Math.round(C.FIRST_HOUR_BONUS * sum);
```

That is a wins-only multiplier — convex at zero. It is structurally identical to the shape `scoring-day.test.ts`'s negative control exists to forbid ("a convex transform of a proper score rewards variance: every honest belief is beaten by a louder one").

Measured on exact expected value, with display rounding removed to isolate the convexity from the known rounding artefact:

| | |
|---|---|
| Honest report optimal at the shipped `0.10`? | Yes, at every belief and every value of the other four questions |
| Narrowest honest-vs-next margin at `0.10` | **0.033 points** |
| Value at which properness first breaks | **`0.11`** — at p=55 with the other four summing near zero, reporting 60 becomes optimal |

It survives only because the 5-point confidence grid is coarser than the distortion. The constant is annotated *"⚙ values may be tuned during TestFlight"*, and no test would catch the break.

**This is the highest-severity finding in the audit** — not because it is wrong today, but because it is one edit away from being wrong silently, in the one subsystem the whole product's credibility rests on.

### 1.2 A lifetime rank is a weak instrument at any sample size this game will reach

Simulated 400 players whose skill governs both which side they pick and how well stated confidence tracks reality, over questions drawn from the author's own contested band (P(yes) ∈ [0.3, 0.7]):

| rated calls | days | rank corr. w/ true skill | median percentile error | of the observed "top 10%", how many truly belong |
|---|---|---|---|---|
| 5 | 1 | 0.23 | ±24 pts | 13% |
| 10 | 2 | 0.30 | ±24 pts | 18% |
| 20 | 4 | 0.42 | ±20 pts | 10% |
| **50** (shipped floor) | **10** | **0.64** | **±15 pts** | **30%** |
| 100 | 20 | 0.74 | ±13 pts | 33% |
| 200 | 40 | 0.86 | ±11 pts | 38% |

Two conclusions, and they set the whole design:

- **Lowering `ORACLE_SCORE_MIN_CALLS` below 50 is strictly bad.** It buys nothing on immediacy (10 calls is still two days, still not day-one) and costs more than half the signal. **The gate stays at 50.**
- **±15 percentile points of median error at the shipped floor means `SHARPER THAN 62% OF 240 SEALED RECORDS` states a precision the data does not have.** In an app whose brand is honesty about calibration, the standing line is the last place that should overstate its own confidence.

The narrowness is structural, not a defect: constraining questions to [0.3, 0.7] is exactly what makes the game worth playing and exactly what makes Brier scores slow to separate people. It is a cost to be represented honestly, not engineered away.

### 1.3 Therefore: two objects, not one tunable gate

| | **The day** | **The record** |
|---|---|---|
| Surface | daily board, on the reveal | standing line, on the plaque |
| Cold start | none — works with one player on install day | 50 rated calls, unchanged |
| Ranks on | raw per-question points, this round only | Oracle Score percentile |
| Precision claimed | exact (it is a result, not an estimate) | a third (it is an estimate) |
| Purchasable input | **none** | none |

Nobody mistakes one day for a rating — that separation is already fluent in the app's own voice ("the day" vs "the record"). This is the same split Wordle relies on, and it dissolves the identity question too: banded, anonymous standing needs no handles, no profiles, no moderation surface, and no App Review UGC exposure.

---

## 2. Change A — the first-hour bonus becomes symmetric

**Files:** `packages/core/src/scoring.ts`, `packages/core/src/constants.ts`, `packages/core/test/scoring-day.test.ts`, `packages/core/src/copy.ts`, `packages/core/test/copy-lint.test.ts`

### Design

Route the bonus through `weighDay`, which already exists and already rounds magnitude symmetrically:

```ts
export function dayPoints(perQuestion: number[], firstHour: boolean): number {
  const sum = perQuestion.reduce((a, b) => a + b, 0);
  if (!firstHour) return sum;
  return weighDay(sum, 1 + C.FIRST_HOUR_BONUS);
}
```

The bonus becomes a positive constant fixed before any of today's outcomes exist — the identical argument that makes `vigilMultiplier` proper. `E[M·S] = M·E[S]`, so the argmax cannot move, **at any value of `FIRST_HOUR_BONUS`**. The tuning ceiling disappears.

`weighDay` is odd, and the composition of odd functions is odd, so `weighDay(dayPoints(xs, true), vigilMult)` stays exactly odd across both multipliers. Assert this — double rounding across two independently-rounded multipliers is precisely where symmetry would be lost without anyone noticing.

### What this changes for the player

Sealing all five inside the first hour now amplifies a **losing** day as much as a winning one. This is a real game-design change and it is the correct one: it is the same bargain the vigil already makes, the app already teaches that bargain in the vigil's own language, and it converts the first hour from a free bonus into a stake.

### Copy

`RITES_LINES` (`copy.ts:190`) currently reads:

> SEAL ALL FIVE WITHIN THE FIRST HOUR. THE DAY PAYS TEN PERCENT MORE.

This becomes false in one direction. Replace with a line that states the symmetry, in register, e.g.:

> SEAL ALL FIVE WITHIN THE FIRST HOUR AND THE DAY WEIGHS TEN PERCENT MORE, WON OR LOST.

Constraints the new line must satisfy (existing lint): mono caps, no emoji, no `!`, none of `CHECK / TAP / CLICK / VISIT / RESULTS / DON'T MISS`, ≤140 chars after worst-case slot expansion.

Add a **copy-lint tripwire** pinning the stated percentage to `FIRST_HOUR_BONUS`, matching the tripwires that already pin `SHIELD_MIN_STREAK`, `CONTRARIAN_MIN_CROWD` and `ORACLE_SCORE_MIN_CALLS`. Tuning the constant must fail the lint rather than silently make a rite lie.

### Tests (write first)

1. **Properness sweep on `dayPoints`**, mirroring `"the vigil multiplier keeps the scoring rule proper"`: exact EV, no integer rounding, honest report optimal at every belief on the grid, for the day's fifth question given every other-four total in a wide range, at slot multiplier 1 and 2. Must hold at `FIRST_HOUR_BONUS` values well past the shipped one (test at 0.10, 0.25, 0.50) — that is the point of the change.
2. **`dayPoints` is exactly odd under the first-hour flag**: `dayPoints(xs.map(negate), true) === -dayPoints(xs, true)` swept over a range, as `vigilPoints` is.
3. **Composition is odd**: `weighDay(dayPoints(xs, true), m) === -weighDay(dayPoints(negated, true), m)` for every `m` in `[1, 1.05, …, 1.5]`.
4. **Negative control retained.** The existing wins-only control must still fail-if-it-passes. Add its twin for `dayPoints`: a wins-only first-hour variant must be shown to reward overconfidence, so the sweep above is proven to have teeth.
5. Existing assertion `"adds 10% first-hour bonus on positive totals only"` is now wrong by design — replace it, do not delete the coverage.

---

## 3. Change B — the standing line becomes a band

**Files:** `apps/mobile/src/game/standing.ts`, `apps/mobile/test/standing.test.ts`, `apps/mobile/src/app/ledger.tsx` (only if the row's height assumption moves)

**The API contract does not change.** `/v1/me/ledger` keeps returning `percentile` and `cohort_size`; the banding is a pure client transform. Smallest possible blast radius, and the raw number stays available.

### Design

`standingLine(percentile, cohortSize)` returns a **third**, not a point estimate:

| percentile | line |
|---|---|
| ≥ 67 | `THE UPPER THIRD OF {n} SEALED RECORDS` |
| 34–66 | `THE MIDDLE THIRD OF {n} SEALED RECORDS` |
| ≤ 33 | `THE LOWER THIRD OF {n} SEALED RECORDS` |
| `null` | `null` (unchanged — "not yet", never "last") |

Thirds, not quintiles: at ±15 percentile points of median error, a 20-point band is inside the noise and a 33-point band is defensible. **Do not** offer a finer band than the measurement supports; that is the exact error being corrected.

The existing `percentile <= 0` special case (`ONE OF {n} SEALED RECORDS`) is **removed** — it was a kindness patch for a point estimate, and the lower third band is already the honest, non-punitive way to say the same thing. The app does not otherwise flinch from unflattering truth (`YOUR CONFIDENCE OUTRUNS YOUR ACCURACY`), and it should not start here.

Keep the existing doc-comment discipline: the *why* (measurement error, not squeamishness) belongs in the file.

### Tests

- Each band at its boundaries (33/34, 66/67), both inclusive edges asserted.
- `null` percentile → `null` line, at every cohort size.
- Cohort size renders verbatim in every band.
- No band ever claims a two-digit percentile.

---

## 4. Change C — the daily board

**Files:** `apps/api/src/routes/round.ts`, `packages/core/src/schemas.ts`, `packages/core/src/constants.ts`, `apps/mobile/src/game/dailyBoard.ts` (new), `apps/mobile/src/api/hooks.ts`, `apps/mobile/src/app/reveal/[date].tsx`, plus tests in `apps/api/test/` and `apps/mobile/test/`

### Endpoint

`GET /v1/round/:date/board` — device-authed, same as every other round route.

```jsonc
{
  "date": "2026-09-02",
  "field_size": 214,        // players who completed the round that day
  "your_points": 137,       // raw skill points; null if the caller did not complete it
  "your_rank": 31,          // 1-based; ties share the better (numerically lower) rank; null if not rated
  "best_points": 268,
  "median_points": 44
}
```

**Ranks on raw per-question points** — `SUM(predictions.points)` over that round's questions, which is `questionPoints` output: big-one multiplier and contrarian bonus included (both earned), **first-hour bonus and vigil multiplier excluded** (one is a timing edge, the other is defended by a purchasable shield).

> This is the single most important line in the change. Ranking on `day_points` would let a purchased shield → longer vigil → larger multiplier → higher rank, which directly contradicts the `SCORE_GLOSS` promise shipped last week that nothing purchasable touches standing. **Money must not buy the board.**

**Eligibility: complete rounds only** — the caller must have answered every question the round asked. This is the same "complete round" rule `settlement.ts:completeRoundBriers` and `/v1/me/ledger` already enforce, it prevents cherry-picking a single easy question, and the app already tells players `THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED`.

**Availability:** the board is readable exactly when points exist — i.e. once **every** question in the round carries an outcome (`resolved` or `void`). While any question is still unresolved the endpoint returns `409`, mirroring `/:date/reveal`'s existing `"not locked"` posture and the client-side `pointsWithheld` rule it drives. Do not invent a second notion of "ready", and do not rank a partially-resolved day: a provisional rank is the same broken promise as a provisional score.

**Small-field floor:** add `BOARD_MIN_FIELD: 5` to `CONSTANTS`, matching the crowd's existing `VERDICT_MIN_PLAYERS` posture. Below it the endpoint returns `field_size` but nulls `your_rank`, `best_points` and `median_points`, and the client prints a gathering line — the same shape `crowdVerdict` already uses. **A rank over three people is mostly the reader.**

Add `RoundBoardSchema` to `packages/core/src/schemas.ts` alongside the others.

### Client

New pure module `apps/mobile/src/game/dailyBoard.ts`, following the established `game/*` pattern (pure, no React, own test file):

```ts
export function boardLines(b: RoundBoard | undefined): string[]
```

- not rated (partial day) → the day-did-not-rate line, no rank
- field below floor → gathering line
- rated → rank line + field shape, e.g. `RANK 31 OF 214` and `BEST 268 · MEDIAN 44`

Rendered on the reveal, in the existing headline block beneath `DAY POINTS`, inside the same `!allSpectator` guard the day-points slot uses. **Height must be reserved** the way every other reveal slot is — the block appears when the query resolves, and the reveal's layout-stability discipline (see `PLAQUE_MIN_H` and the audit's §8 note) is not to be broken by this change.

Copy must clear the existing lint register: caps, no emoji, no `!`, no banned CTA verbs.

### Tests

**API:** raw points used (a player with a large vigil multiplier does not outrank a better raw day); partial-round players excluded from `field_size` and given a null rank; ties share the better rank; below-floor fields null the comparative fields; unresolved round withholds; unknown date 404s; caller-scoping (the board never leaks another player's identity — it returns aggregates and the caller's own row, nothing else).

**Mobile:** each `boardLines` state; reserved height holds across states.

### Explicitly out of scope

No named entries, no profiles, no handles, no friend graph, no all-time board. Anonymous aggregates only.

---

## 5. Change D — the evergreen bank refills itself

**Files:** `apps/api/src/pipeline/state.ts`, `apps/api/src/pipeline/author.ts`, `apps/api/src/pipeline/index.ts`, tests in `apps/api/test/`

### The gap

`publishFromBank` burns one entry per use. The only writer is `POST /admin/bank`. `decideActions` has no authoring action for the bank and no low-water alert — the only warning fires once the bank is already empty *and* tomorrow is unauthored. The stated invariant, *"the drop must never depend on the agent being alive"* (design §6), holds until the buffer drains and then silently stops holding.

### Design

New action `{ kind: "author-bank" }`.

- **Trigger** in `decideActions`: `bankCount < BANK_LOW_WATER` **and** `hour === 3 && minute < 10`. Off-peak, at most once per day, well clear of the 17:00 authoring window and the noon drop. One entry per firing — the bank refills over days, which is fine because the low-water mark is the buffer.
- **Constant** `BANK_LOW_WATER = 5`, in the pipeline (ops tuning), **not** in `@oracle/core` (game rules). Do not put an operational threshold in the file whose header says "Scoring/game tunables".
- **Executor** `authorBankEntry(deps)` in `author.ts`, reusing the existing structured-output plumbing with a dedicated evergreen system prompt:
  - all five questions **must** be `resolves_at: "after-lock"` — mirroring the constraint `POST /admin/bank` already enforces at ingest
  - therefore **no weather** (the schema forbids weather from `after-lock`)
  - date-agnostic: nothing referencing a specific date, event, or "today"
  - all other authoring rules unchanged (contested 0.3–0.7, one named public source, exactly one big one at slot 5, ≥4 distinct categories, the same FORBIDDEN list)
  - validate with `DraftSchema` **and** reject any entry with a non-`after-lock` `resolves_at` before insert, so the bank cannot be poisoned by its own author
- **Insert** into `draftBank`. Narrate to Telegram with the new count.
- **Low-water alert:** extend the existing 23:00 alert window to warn when `bankCount < BANK_LOW_WATER`, distinct from the existing empty-bank critical.

`publishFromBank`'s poison-skip path is unchanged and still the last line of defence.

### Tests

`decideActions` fires `author-bank` only inside the window and only under the low-water mark; does not fire at or above it; does not collide with the 17:00 author action; a bank entry whose draft carries a dated `resolves_at` is rejected before insert; the low-water warning is distinct from the empty-bank critical.

---

## 6. Change E — the question-quality scorecard

**Files:** migration `apps/api/drizzle/0006_*.sql` + snapshot, `apps/api/src/db/schema.ts`, `apps/api/src/pipeline/draft.ts`, `apps/api/src/pipeline/author.ts`, `apps/api/src/pipeline/quality.ts` (new), `apps/api/src/pipeline/actions.ts`, tests in `apps/api/test/`

### The gap

`author_probability` is validated (0.3–0.7) and then **thrown away** — `upsertDraft` never persists it. So the author's own stated probability can never be scored against what happened, and the only feedback it gets is seven days of prose. Nothing anywhere measures whether questions were actually contested, which is upstream of everything else in this spec: **ranking people on uncontested questions makes any board a participation trophy.**

### Design

**Migration 0006:** add `questions.author_prob numeric` (nullable — every existing row predates it). Follow the repo's existing Drizzle migration + snapshot convention exactly.

Persist it in `upsertDraft` and in `rerollSlot`'s update. It is already carried on `DraftQuestionSchema`; this is only a write.

**New pure module `apps/api/src/pipeline/quality.ts`** — pure functions over plain rows, no I/O, in the style of `leak.ts`:

```ts
export interface QualityRow {
  outcome: "yes" | "no" | "void" | null;
  crowdYesPct: number | null;
  crowdCount: number | null;
  authorProb: number | null;
}
export interface QualityReport {
  n: number;
  voidRate: number | null;          // voided / total
  uncontestedRate: number | null;   // resolved rows where the crowd landed ≥ UNCONTESTED_PCT one way
  authorBrier: number | null;       // mean (authorProb − outcome)² over resolved rows carrying a prob
}
export function questionQuality(rows: QualityRow[]): QualityReport
export function qualityReport(r: QualityReport): string[]
```

- `UNCONTESTED_PCT = 85`, module-local.
- `uncontestedRate` counts only rows above the crowd floor (`CONTRARIAN_MIN_CROWD`) — a 100% crowd of two is not consensus, it is a small sample, and this metric must not repeat the bug the audit already fixed on the finale.
- Every metric returns `null` rather than a misleading zero when its denominator is empty. Metrics are independent: a window can have a computable void rate and no author Brier. Render each on its own terms — the same lesson `leakReport` already had to learn.
- `authorBrier` is the headline: it is the one number that says whether the author's claimed uncertainty was real. Near 0.25 means genuinely contested; well below means the author was writing gimmes and calling them 50/50.

**Wire into the settle report** (`actions.ts:settle`), beside the existing `LEAK WATCH` block, over a trailing 28-day window. Carry a legend on the header line — readable cold, per the same rule `leak.ts:HEADER` follows.

**Wire into authoring** (`author.ts:authorSystemPrompt`): a compact metrics block above the existing 7-day digest, so the author sees its own aggregate record, not just seven anecdotes. The digest itself stays — outcome and crowd split per question is the qualitative half and it is working.

### Tests

Each metric in isolation; empty and all-void windows return `null` not `0`; the crowd floor is enforced in `uncontestedRate`; `authorBrier` skips rows with a null `authorProb`; a report line renders each metric independently when the others are absent; `upsertDraft` and `rerollSlot` both persist `author_prob`; the settle report contains the block.

---

## 7. Sequencing

Two waves. Wave 1's three tracks touch disjoint files and run in parallel. Wave 2 depends on A only for shared files (`constants.ts`, `reveal/[date].tsx`), not for logic.

**Wave 1 (parallel):**
- **A** — first-hour properness. `packages/core` only.
- **D** — bank refill. `apps/api/src/pipeline` only.
- **E** — quality scorecard. `apps/api` (migration, pipeline) only.

**Wave 2 (parallel):**
- **C** — daily board. Owns `apps/mobile/src/app/reveal/[date].tsx`, and therefore also carries A's one-line display consequence: the `d.day_points > 0` gate on the `FIRST HOUR +10%` line must go, since the bonus now applies to losing days too, and its label must state the symmetry.
- **B** — standing bands. Owns `apps/mobile/src/game/standing.ts` and `ledger.tsx`.

File ownership is exclusive within a wave. No two concurrent tracks write the same file.

### Method

TDD throughout, matching this repo: tests first, watch them fail for the right reason, then implement. Typecheck and the full suite must be green per track before it reports done. Commit messages follow the repo's existing voice.

---

## 8. Explicitly not in scope

- **`ORACLE_SCORE_MIN_CALLS` stays at 50.** §1.2 is the argument.
- **No named or friends leaderboard.** Needs a domain, universal links, display names and moderation; none of that fits this week, and §1.3 shows the anonymous version carries the value.
- **No change to `resolveBy`.** It is dead and its own schema comment says so — a cleanup, not a launch item.
- **The remaining §7 notes from the 2026-09-02 audit** (10s crowd poll on Home, unread `idempotency_key`, the all-closed/none-sealed frame).
- **`TURN THE LAST CARD`** on the reveal.

## 9. Erik's blockers — code cannot close these

- `EXPO_PUBLIC_PRIVACY_URL` — **a hard App Review rejection today.** The paywall renders no privacy link without it.
- `EXPO_PUBLIC_SHARE_URL` — without it the share message ships with no link and the viral loop stays open-circuit.
- `SENTRY_ORG` — the plugin drops itself when unset, so builds are safe, but there is no crash reporting without it.
- Cloudflare secrets actually set, and `PIPELINE_ENABLED="true"` — the pipeline is inert until it is.
- Universal links / `associatedDomains` — needs the domain.
