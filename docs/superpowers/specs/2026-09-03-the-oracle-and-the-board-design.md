# ORACLE — The Oracle Takes a Position, and the Board Becomes a Room

**Date:** 2026-09-03 (27 days to Shipaton deadline)
**Status:** design approved in chat 2026-09-03, section by section. Extends `2026-09-01-window-seeding-story-audit.md` §3.3 and `2026-09-03-standing-and-lifecycle-design.md` §4.
**Baseline:** `main` @ `567a242`.

---

## 0. What this is

Two changes that turn out to be one change.

1. **THE ORACLE becomes a character with a record.** It forecasts every question, crowd-blind, before anyone plays; it is scored on the same rule as the players; and it can lose.
2. **The daily board becomes a room with people in it** — a ranked list of machine-assigned designations rather than a rank and two aggregates.

They join at one row: **the Oracle stands in the board's list, by name, ranked among the players.** That row does more character work than any copy, and it makes the reveal, the plaque and the board tell one story instead of three.

Neither change is on the critical path to App Store submission. Both are recorded here now because the design is fully decided and the implementation is not urgent.

---

## 1. The finding that shaped this: the Oracle is currently the crowd wearing a mask

`stampForecasts` (`pipeline/actions.ts:23`) calls `oracleForecast` (`packages/core/src/forecast.ts:10`), which begins:

```ts
if (ratedPlayerCount < C.FORECAST_MIN_RATED) {
  return predictions.reduce((a, x) => a + x.pYes, 0) / predictions.length;
}
```

`FORECAST_MIN_RATED` is **500** (`constants.ts:42`). Skill-weighting and extremization do not engage until 500 players each carry an Oracle Score, which requires 500 people × 10 complete days.

So today `THE ORACLE FORESAW 62% YES` (`reveal/[date].tsx:389`) and `CROWD SAID 62% YES` (`:384`) are the same quantity computed twice, and the Big One block presents them as two characters. Building a rivalry on top of that would put a false claim on the app's most-read screen, in a product whose entire brand is that the ledger does not lie.

**Ruling: `oracleForecast` is deleted, not deferred.** `extremize`, `FORECAST_MIN_RATED`, `FORECAST_WEIGHT_PIVOT` and `FORECAST_WEIGHT_SCALE` go with it. The skill-weighted crowd is a good idea for a *different* statistic later; keeping it alive alongside a real Oracle would leave two things claiming one name. Git remembers it.

---

## 2. The Oracle forecasts at publish

### 2.1 Why publish and not lock

The obvious placement is lock, because that is where `stampForecasts` runs today. It is wrong.

Lock is noon ET on D+1 — the same instant resolution begins. A forecaster with web search, invoked then, is looking up answers that already exist. That is precisely the leak closed in the authoring contract on Sept 1, reintroduced on the machine's side of the table.

**The forecast is taken at publish — noon ET on D, as the round goes live.** Three properties fall out with no enforcement required:

- **Crowd-blind by construction.** No predictions exist yet. There is nothing to peek at, so no test needs to prove it did not.
- **Leak-free by construction.** It commits 24 hours before lock, earlier than any player can.
- **It is bound by its own liturgy.** The Oracle answers first, never revises, and is read without mercy alongside everyone else. `NOTHING REVISED` stops being a line the app recites and becomes a rule its own character obeys.

### 2.2 Mechanism

A `forecast` step inside `publish` and `publish-bank` (`pipeline/actions.ts`), executed **before** the questions go live.

- One `deps.claude.structured` call for all five questions; structured output is five `{slot, p_yes}` pairs, `p_yes ∈ [0,1]`.
- Web search **on**. The player has today's news; so does the Oracle. Denying it search would make the comparison unfair in the player's favour, which is as dishonest as the reverse.
- Model behind a new `PIPELINE_FORECAST_MODEL` var, tunable like `PIPELINE_AUTHOR_MODEL` and `PIPELINE_RESOLVE_MODEL`.
- The forecasting prompt **must not** receive `author_prob`. The author's stated probability is a target chosen to make the question contested, not a belief; feeding it to the forecaster would make the Oracle grade its own homework.
- **Failure is non-fatal.** No forecast leaves `oracle_p_yes` null and the day simply carries no Oracle line — the same degradation posture `market_prob` already has. The drop must never block on the forecaster.

### 2.3 Storage

`questions.oracle_p_yes` is reused. The column name was already right; only its writer changes. **No migration.**

**Data note:** rows written before this change hold crowd aggregates and would poison the Oracle's record. One statement against oracle-dev, not a migration:

```sql
UPDATE questions SET oracle_p_yes = NULL;
```

There is no prod database yet (verified Sept 3), so nothing else is affected.

---

## 3. The Oracle's record needs no schema

Every question already carries `oracle_p_yes` and `outcome`. The Oracle's Brier, its resolved-call count and its Oracle Score are a pure aggregate over `questions` — computed on read, exactly as `/v1/me/ledger` computes the player's.

- It meets the same `ORACLE_SCORE_MIN_CALLS: 50` floor. **For the first ten days the Oracle is `UNWRITTEN` too**, and it is named in the same week the player is. That symmetry is the week-one hook and it is free.
- Scored on plain affine-Brier: **no contrarian bonus, no vigil multiplier, no first-hour weight.** None of the three is meaningful for a machine, and letting any of them touch the Oracle would tilt the comparison in the machine's favour and break the one promise `SCORE_GLOSS` makes.
- No table, no settlement hook, no `resettleRound` hazard.

**Call-counting rule**, so the edges are honest:

| Oracle `p_yes` | Counted as |
|---|---|
| `> 0.5` | a YES call |
| `< 0.5` | a NO call |
| `= 0.5` | **abstention** — leaves the denominator |

The machine is allowed to decline. Forcing a coin-flip would flatter it, since a forced call is right half the time by construction. Void questions drop out for both sides, as everywhere else.

---

## 4. Surfaces

### 4.1 The reveal gets one line, not five

The ordinary reveal rows are tight two-liners. An Oracle line under each would roughly double the screen's text weight for a comparison the player cannot act on.

**One row: `YOU 3 · THE ORACLE 4`.** It lands **after** the Big One block, not with the day points. The day points are the player's verdict; the Oracle line is the day's closing sting, and it only stings once the player already knows how they did. One new delay constant.

**The Big One block keeps its detail line.** It already carries `CROWD SAID` and `THE MARKET SAID`; `THE ORACLE FORESAW 62% YES` joins them and now needs a verdict mark beside it, because for the first time that sentence can be false. This block becomes the one place all three characters are fully present — which the original design spec claimed it already was.

### 4.2 The plaque gets the rivalry

Two additions to `GET /v1/me/ledger`, both compute-on-read:

- **The Oracle's score beside the player's**, in the existing lead-stat grammar. Before either is written it reads as two `UNWRITTEN · n OF 50` rows side by side.
- **`YOU HAVE OUTSEEN THE ORACLE ON 4 OF 11 DAYS`** — the sentence that makes it a rivalry rather than a static comparison. One join over the caller's predictions and the questions' outcomes; no heavier than the aggregates the route already computes. Complete rounds only, matching every other rated surface.

### 4.3 The night share card gets one line

`THE ORACLE 4 · YOU 3`, gold when the player is ahead.

This is the highest-value line in the track from a distribution standpoint: *I beat the machine today* is a claim a person wants to post, and it travels far better than a point total a stranger cannot calibrate.

**ASCII only — no `✓` or `✗`.** Skia has no font fallback and that trap has already been hit twice in this codebase.

---

## 5. The board becomes a room

`GET /v1/round/:date/board` returns a rank and two aggregates. A rank tells the player a number; a list tells them there are people there.

### 5.1 Designations, not handles

Every player gets a **stable pseudonym derived deterministically from their user id**. No column, no claim flow, nothing a user typed ever renders — therefore no report path, no profanity gate, and no App Review conversation about user-generated content.

- Two words, in register, drawn from a sight-and-ledger pool: `THE PATIENT SCRIBE`, `THE COLD WITNESS`, `THE RESTLESS HAND`.
- Lives in `@oracle/core` so the copy lint guards its voice like everything else: caps, no emoji, no CTA verbs.
- Pool shape ~30 modifiers × ~20 roles ≈ 600. Only ~10 rows are ever visible at once, so a visible collision is rare; when one occurs it is **disambiguated within the rendered window**, not by growing the pool.

**Stability across days is the feature.** A designation that changes daily is cheaper to generate and worth far less: if `THE COLD WITNESS` has beaten the player three days running, they have a rival they never agreed to have, at zero build cost.

### 5.2 The Oracle stands in the list

The machine takes a row, by name, ranked among the players on its day points as defined in §3. Some days the player is above it. Most days, early on, they are not.

The Oracle's row is **pinned into the window even when its rank falls outside it**, showing its true rank — the player should never have to scroll to find out where the machine placed.

### 5.3 Shape

The route keeps its existing aggregates and gains `rows`.

- **Window:** the top few, then the caller's own neighbourhood with the caller marked in place, so a mid-field player sees the summit *and* the people immediately around them. Capped at roughly ten rows plus the pinned Oracle.
- A caller who did not complete the round has no row; the top rows still render.
- **Unchanged and non-negotiable:** `BOARD_MIN_FIELD: 5` still gates it; complete rounds only; still 409 until every question carries an outcome; still ranked on raw `SUM(predictions.points)` so that the first-hour bonus and the shield-defended vigil multiplier stay out and **money cannot buy a place on the board**.

### 5.4 The callout survives

One line above the list when the day earned it — `ONE WHO SAW: +268, ALONE AGAINST 82%`. A list of rows cannot carry that on its own, and it is the voice moment the board otherwise lacks.

---

## 6. Deliberately not in this spec

- **Score progress on home.** Wanted (audit §3.2), but it belongs to the finding-ceremony track; building it here would design that ceremony halfway.
- **The finding ceremony at 50 calls.** Its own track.
- **Per-question Oracle marks on ordinary reveal rows.** Noise.
- **`TURN THE LAST CARD`** (audit §4.1). A real improvement, unrelated, and it touches the reveal's whole choreography.
- **Promoting `author_prob` into a character.** It stays exactly where it is, as question-quality telemetry feeding `authorBrier`. Conflating the question-writer's target with a forecaster's belief would make `authorBrier` unreadable.
- **Epithets on board rows.** Noted as the natural payoff — once a player crosses 50 rated calls their row could show their earned epithet instead of their assigned designation, so the ledger *records everyone and names only those it can prove*. One conditional, belonging to the finding-ceremony track.

---

## 7. Test obligations

- `oracleForecast` and its constants are deleted; any test asserting the weighted-crowd behaviour goes with them. No test may be left asserting a behaviour that no longer exists.
- The call-counting rule of §3, including the `p = 0.5` abstention and void exclusion, gets a direct unit test — the abstention is the rule most likely to be quietly "simplified" into a coin flip later.
- The Oracle's day score is asserted to receive **no** contrarian bonus, **no** vigil multiplier and **no** first-hour weight. This is a tripwire, so per the Sept 3 copy-lint lesson it must be **bound to the specific code path that makes the claim and proven to ring by breaking it** — not asserted against an aggregate where it could pass vacuously.
- Board rows: designation determinism (same user id → same designation across days), in-window collision disambiguation, the pinned Oracle row when it ranks outside the window, and a caller with no completed round.
- Forecast failure leaves `oracle_p_yes` null and publish still succeeds.
- Fixture-based only; the forecaster is injected through `PipelineDeps` like every other model call, and tests never touch the network.

---

## 8. Open, and Erik's

1. **Is the Oracle too strong or too weak?** Unknowable until it has run real days. Aggregation usually beats individuals, so expect the machine to win early and often; whether that reads as *a worthy antagonist* or *a wall* is a device-and-data judgement, not a design one. The lever, if it needs one, is the forecasting prompt, never the scoring rule.
2. **Designation pool wording.** The 600 words are a voice artefact and get Erik's eye before they ship.
3. This spec assumes the pipeline is armed and running real rounds. It is not yet — see the sequencing note in §0.
