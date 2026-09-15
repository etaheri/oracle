# The Hand: swipe, the double, and runs

Design, September 14, 2026. Amends the House design (`2026-09-10-the-house-design.md`) at §4.2, §4.6, §8.2, §8.3 and decisions D11 and D13, after the second reading of the first playtest. Written against the code as it stands with Plans 1 to 3 merged. Where this document and the House spec differ, this one is current. The Council design is untouched.

## 1. The problem this solves

The first playtest said three things: the pull was hard to control, the rules were a lot of metaphors, and it could not tell whether confidence muddied the game. D11 to D13 answered the first two. The third was answered by hiding the number behind money, which left the seal with two decisions per card, a five-rung ladder whose middle rung is preselected, and a recorded "confidence" that is whatever rung looked like good money. That number is no longer a probability, so the calibration record built on it is no longer a record of anything.

The same reading found that a fortune below ten is a dead end. The floor rules keep it above zero, and nothing gives a player at forty a reason to open the app tomorrow.

This design makes the daily action one swipe per card, moves conviction into one decision per round, and turns the fortune into a run with a bust and a best.

## 2. The game in one paragraph

Every day at noon ET the Oracle deals five cards, each a live market with the Oracle's line on it. Swipe right for YES, left for NO; the swipe is the seal, and every call stakes five percent of your fortune, the Big One ten. After the fifth seal, place your double on the one call you are surest of: its stake doubles. Right calls pay at the Oracle's odds, wrong calls lose the stake. If your fortune falls under 100 the house has taken it, a new fortune of 1,000 opens at noon, and your best fortune stays on your record.

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| H1 | Version 3 is amended in place. There is no version 4. | Production has never run a version 3 round. Stakes are frozen on the prediction row, so rounds already played in development keep their arithmetic without a version. |
| H2 | The side is a swipe, and the swipe is the seal. The YES and NO buttons under the card stay, and tapping one seals the same way. | The playtest's complaint was a continuous pull that set a number. A swipe sets a bit. One gesture per card, and a button path for accessibility and for anyone who does not discover the swipe. Replaces D11. |
| H3 | Every call stakes a flat `STAKE_FRACTION` of five percent of the fortune, ten on the Big One. The ladder, the confidence grid on the seal, and the floor rules below ten are retired. | Five percent is today's preselected rung. The bust (H5) keeps the fortune at or above 100, so a floor of one is enough. Replaces D13. |
| H4 | One double per round, placed on one of the player's own sealed calls after the fifth seal, before that question's lock. It doubles the stake. It stacks on the Big One. Once placed it cannot move. | The double is the one place a player says where their edge is largest, and that judgement needs the whole hand. Stacking is the loud option on the tray, and noticing that the house is also surest on the Big One is the skill the game rewards. Fixed once placed for the same reason a seal is. |
| H5 | A fortune under `BUST_UNDER` (100) at settlement is a bust: the fortune returns to 1,000 and the run restarts. The record and the all-time board carry the best fortune ever reached. | A fortune at 40 is dead and the player knows it. A bust is a clean thousand and a best to beat, which is the reason to open the app after a bad night. |
| H6 | The run has one number, the best fortune. No run count, no days survived, no bust count on any surface. | The streak already counts days. A second day-count would be the kind of complication D12 removed. |
| H7 | No rescue purchase. Streak protection remains the only thing money buys. | A fortune rescue would sell and would break the rule that a purchase never touches the score. |
| H8 | Confidence leaves the player-facing surface: the seal, the record's calibration block, the rules, the site. The column stays and the seal route writes a constant, `CONFIDENCE_FLAT` (75), on every new prediction. | Forty files read the column. A constant keeps points, Brier and the Council's crowd figures computing without a migration through all of them; the readers that showed the number are removed instead. The column is deleted after the deadline. |
| H9 | The reveal's headline stays the fortune delta. No second scoreboard. | A right-count duel line was considered and dropped; it would compete with the one number the game is about. |
| H10 | The open record is the research artefact. The calibration ledger claim of House §4.6 and §12 is withdrawn. | With a flat stake the recorded probability is a constant. The Council's CSV is clean and public, and it is what the research pitch rests on. |
| H11 | Practice uses the same swipe card on the practice fortune. Practice has no double. | Practice is one card; the double is a hand decision. |

## 4. Stakes, the double and fortune

Constants live in `packages/core/src/fortune.ts`. `STAKE_FRACTION_MAX`, `FLOOR_FROM`, `LADDER_CONFIDENCES`, `LADDER_DEFAULT`, `stakeFraction`, `stakePreview` and `stakeLadder` are deleted.

```
FORTUNE_FOUNDING   = 1000
STAKE_FRACTION     = 0.05   // ⚙ tunable; every call
BIG_ONE_MULT       = 2      // existing constant, the house's double
DOUBLE_MULT        = 2      // the player's double
BUST_UNDER         = 100    // ⚙ tunable; a fortune under this at settlement busts
CONFIDENCE_FLAT    = 75     // written to predictions.confidence; never shown
```

### 4.1 Stake

```
stake(fortune, isBigOne) = max(1, round(fortune × STAKE_FRACTION × (isBigOne ? BIG_ONE_MULT : 1)))
```

Computed from the fortune at the instant of the seal and frozen on the prediction, as today. Nothing is debited at seal. The floor of one applies always; the bust rule is what keeps stakes meaningful.

### 4.2 The double

```
doubledStake(stake) = stake × DOUBLE_MULT
```

Applied once to `predictions.stake` when the double is placed (§6.2). Every reader of `predictions.stake` picks it up unchanged: `payFortune`, the round's house delta, the standings' member house delta, the daily board's return.

Fortune in play on a round of five all wrong: 5 + 5 + 5 + 5 + 10 = 30 percent, or 40 with the double on the Big One, against 54 today.

### 4.3 Odds and payout

Unchanged from House §4.3.

### 4.4 Fortune, the run and the bust

`users.fortune` is written by `payFortune` (resolution) as today, and by the bust (settlement), and nowhere else. The comment on `users.fortune` and in `resolution.ts` changes to say so.

```
at each payout:  users.fortune += delta
                 users.best_fortune = greatest(users.best_fortune, users.fortune)
at settlement of a round, after every payout has landed, for each player of the round:
  if users.fortune < BUST_UNDER:
      user_rounds.bust_fortune = users.fortune     // the fortune the house took it at
      users.fortune = FORTUNE_FOUNDING
      users.run_started_on = round date + 1 day
```

`best_fortune` is maintained in the same statement as the payout so it can never lag the fortune. A run is the rounds from `run_started_on` onward; the founding run has `run_started_on` null and starts at the account.

A bust is judged once, when the round settles, not per question: a fortune may dip under 100 on the fourth card and recover on the fifth. The bust write is conditioned on the fortune being under the threshold, so a retried settlement cannot bust twice. A player who did not stake on the round cannot bust on it.

If a player has already sealed the next round when the bust lands, those stakes were cut from the old fortune and stay frozen; their deltas apply to the new thousand. This is the same rule as any early settlement and needs no special case.

### 4.5 Return on the day

Unchanged. `user_rounds.fortune_at_open` is the denominator, written at the first seal.

### 4.6 What the confidence column means now

Nothing to the player. `CONFIDENCE_FLAT` is written on every new prediction by the API; the client sends no confidence. Points and Brier keep computing on the constant so that version 1 and 2 reveals, the crowd figures on the standings, and the admin views need no change. The record no longer renders any of it (§8.4).

## 5. The seal

### 5.1 The card

The five cards are dealt one at a time from a stack, as today. The card face shows the question and `THE ORACLE'S LINE · 35% YES`. Under the card, in place of the ladder, one line: `STAKE 50 · WINS 93` for YES and `STAKE 50 · WINS 27` for NO, both shown, computed by the core preview at the flat stake. On the Big One the line reads `THE BIG ONE · STAKE 100 · WINS 186` and `WINS 54`.

### 5.2 The swipe

A horizontal pan on the card. While dragging, the card leans and washes toward the side it is heading for, the existing lean and wash, and the YES or NO label brightens. Release past `SWIPE_COMMIT`, 35 percent of the card's width, or above a velocity threshold, seals: the throw animation that exists today plays, the request goes concurrently, and a failure flies the card back in with the existing error handling (409 lock → `THE ORACLE HAS CLOSED`, round invalidated). Release short of the commit springs the card back to centre. Vertical scroll is not captured.

Tapping YES or NO under the card seals the same way, with the same throw. There is no separate seal button and no confirmation. A submit in flight disables the gesture and the buttons. Reduced motion skips the throw and keeps the buttons.

The receipt line under the stage reads `YES · STAKED 50 · WINS 93`, as today.

### 5.3 After the fifth seal: the tray

When no open card remains and the player has at least one sealed call whose question has not locked and the double is unplaced, the stage shows the tray in place of the crowd finale:

- Title `PLACE YOUR DOUBLE`, one line under it in reading register: "Your surest call. Its stake doubles."
- One tile per sealed call, in slot order: the numeral, the question text on at most two lines, the side taken in its colour, and `STAKE 50 → 100 · WINS 93 → 186`. The Big One's tile carries its `THE BIG ONE` stamp. A tile whose question has locked is shown dimmed and cannot be chosen.
- Tapping a tile places the double: heavy haptic, the tile marks `DOUBLED`, the others settle, and after a beat the stage moves to the crowd finale. One tap. No preselected tile, no undo, no second step. The tray has five large targets and nothing else, and a second step would rebuild the ladder's two taps for one decision.
- Leaving the tray unplaced is allowed. Home shows `YOUR DOUBLE IS UNPLACED` in the notice slot until the last lock, tapping through to the round screen, which shows the tray again. At the last lock an unplaced double is simply unspent.

Once placed, the round screen shows the crowd finale as today, with the doubled call's receipt reading `YES · STAKED 100 · WINS 186 · DOUBLED`.

### 5.4 Practice

The practice card is the same component on the practice fortune of 1,000 and the exhibition's line. The hint reads `SWIPE RIGHT FOR YES, LEFT FOR NO`, or `TAP A SIDE TO SEAL` when reduced motion has turned the gesture off. Neither carries a full stop: at iPhone width the stop pushed the swipe hint onto a second line under the card, and the tap hint drops its own for symmetry. The retry reads `TRY THE OTHER SIDE`. No tray.

## 6. API

### 6.1 The seal

`POST /v1/predictions` takes `{ question_id, answer, idempotency_key }`. `confidence` is accepted and ignored so the build on the store keeps sealing; the schema marks it optional and the route never reads it. The row is written with `confidence = CONFIDENCE_FLAT` and `stake = stake(fortune, isBigOne)`. Everything else about the route, including the lock checks, the single-insert idempotency and the `user_rounds` row at the first seal, is unchanged. The response is unchanged.

### 6.2 The double

`POST /v1/predictions/double` takes `{ question_id }`.

1. The question must exist, its round must be `open`, and `now < question.locks_at`, else 404 or 409 `locked`.
2. The caller must have a prediction on it with `stake` not null, else 404.
3. One data-modifying statement places it:

```sql
WITH placed AS (
  UPDATE user_rounds SET double_question_id = $q
  WHERE user_id = $u AND date = $d AND double_question_id IS NULL
  RETURNING user_id
)
UPDATE predictions SET stake = stake * 2, doubled = true
FROM placed
WHERE predictions.question_id = $q AND predictions.user_id = placed.user_id AND predictions.settled_at IS NULL
RETURNING predictions.stake
```

4. Zero rows means the double was already placed. If it is on this question, 200 with the current row; otherwise 409 `placed`.
5. Response `{ question_id, stake, wins }`.

`user_rounds.double_question_id` is the one-per-round rule; the statement is atomic on the Neon HTTP driver because it is one statement, the same reasoning as `payFortune`. A trigger, `guard_double`, rejects any other change to `predictions.stake` after insert: the only permitted update is `doubled` false to true with the stake exactly doubled and `settled_at` null.

### 6.3 Today

`GET /v1/round/today/mine` gains `stake` and `doubled` on each prediction and a top-level `double_question_id`, nullable. `GET /v1/round/today` is unchanged; the card prices from `fortune` and `line_p_yes` as today.

### 6.4 Reveal

`GET /v1/round/:date/reveal` gains `my.doubled` per question and a top-level `bust_fortune`, nullable, from `user_rounds`. `fortune_after` becomes `bust_fortune` when it is set, so a busted reveal shows the fortune the house took it at rather than the new thousand. Points fields stay for version 1 and 2 clients and are not rendered for version 3.

### 6.5 Ledger

`GET /v1/me/ledger` gains `best_fortune` and `run_started_on`, nullable. `fortune_history` is rebuilt from founding over the rounds of the current run only, those on or after `run_started_on`. `confidence_history`, `avg_confidence`, `accuracy_pct`, `oracle_score` and `percentile` keep being served; the client stops rendering them.

### 6.6 Boards

The all-time board ranks by `users.best_fortune`. `AllTimeBoardSchema` renames its numbers: `your_best`, `best`, `median_best`, rows carry `best`. Eligibility is unchanged: at least one settled stake. The daily board is unchanged.

### 6.7 Settlement

`settleRound` gains the bust step after the fortune backstop sweep and before the house delta, for every user in the round's audience who has a settled stake on it:

```sql
WITH busted AS (
  UPDATE users SET fortune = 1000, run_started_on = ($d::date + 1)
  WHERE id = $u AND fortune < 100
  RETURNING id, $f AS was
)
UPDATE user_rounds SET bust_fortune = busted.was
FROM busted WHERE user_rounds.user_id = busted.id AND user_rounds.date = $d
```

where `$f` is the fortune read in the same request before the update. The bust write is idempotent through its condition; the round status remains the settlement's guard.

`payFortune`'s statement gains `best_fortune = GREATEST(best_fortune, fortune + ($pay - $stake))` in its `UPDATE users`.

## 7. Schema

Migration `0016`, generated then appended:

| Table | Column | Notes |
| --- | --- | --- |
| `users` | `best_fortune integer NOT NULL DEFAULT 1000` | Highest fortune ever reached, any run. |
| `users` | `run_started_on date` | Null for the founding run. |
| `user_rounds` | `double_question_id uuid REFERENCES questions(id)` | The one-per-round rule. |
| `user_rounds` | `bust_fortune integer` | Non-null means this round busted, at this fortune. |
| `predictions` | `doubled boolean NOT NULL DEFAULT false` | For the reveal and the tray. |

Appended: the `guard_double` trigger (§6.2). `predictions.confidence` stays `NOT NULL`; the API supplies the constant.

## 8. Mobile

### 8.1 Vocabulary

Arrives: the double, best. Leaves: the ladder, rung, confidence, calibration, forecast rating. The retired-word lint in core and mobile gains `confidence`, `calibration`, `rungs?`, `ladder`. The Council's names are untouched.

### 8.2 The card

`sealFlow.ts` loses `confidence`; the choice is `{ side }`. `StakeLadder.tsx`, `LadderTable.tsx`, `rungLabel`, `rungA11y`, `unstakedRungLabel` and `ladderTable` are deleted. `stakeText.ts` gains `sideLine(side, stake, wins)` for the two-side line under the card. `OracleCard.tsx` gains the pan gesture and loses the ladder and the SEAL button; `roundStore` entries lose `confidence` and gain `stake` and `doubled`.

### 8.3 The tray

Pure module `apps/mobile/src/game/doubleTray.ts`: `trayTiles(questions, mine, now)` returns the tiles in slot order with `stake`, `doubledStake`, `wins`, `doubledWins`, `locked`; `trayState(questions, mine, double_question_id, now)` returns `hidden | open | placed`. Component `DoubleTray.tsx` renders it. `round.tsx` chooses tray or crowd finale by `trayState`. Hook `useDouble()` posts to `/v1/predictions/double` and invalidates `["round","mine"]` and `["round","today"]`.

### 8.4 Surfaces

| Surface | Change |
| --- | --- |
| Home | Notice priority becomes protection, then the unplaced double, then risk, then lapse, then the kept streak. `doubleNotice(trayState)` in `homeLines.ts`. The double notice links to the round screen. |
| Reveal | The doubled call's row carries a `DOUBLED` mark beside its stake. When `bust_fortune` is set, one block under the headline: `THE HOUSE TOOK IT ALL` on the first line, `BEST 3,400` on the second, and "A new fortune of 1,000 opens at noon." in reading register. The Big One block reads `YOU: YES`, no percent. `revealObservation`'s most-confident-call line is replaced by one about the double: `YOUR DOUBLE PAID` or `YOUR DOUBLE WAS WRONG`, only when a double was placed and decided. |
| Record | Lead stat `FORTUNE`, then `BEST` beside it, then the fortune history of the current run. The calibration block (forecast rating, gloss, accuracy, average confidence, confidence history) is removed. Rounds played, streak and streak protection stay. |
| All-time board | Title `BEST FORTUNE`, rows by best. |
| Rules | `INTRO_LINES` become: "The Oracle posts its line on five questions a day." / "Swipe right for YES, left for NO. Every call stakes five percent of your fortune." / "After your fifth seal, place your double on the call you're surest of. Right calls pay at the Oracle's odds." Four sections stay. "The game" replaces its stake claim with the flat stake and the double, and its never-zero claim with the bust. "Your record" replaces the calibration claim with best fortune. The ladder rite and `LadderTable` go. Claim count stays within the lint's 18 to 24. |
| Share card | Unchanged. |
| Practice | §5.4. |

### 8.5 Copy

Recognised things in tracked caps: `PLACE YOUR DOUBLE`, `DOUBLED`, `YOUR DOUBLE IS UNPLACED`, `THE HOUSE TOOK IT ALL`, `BEST`. Read things in sentence case. Every new string passes the copy lints as they stand: no banned verbs, no exclamation, under 140 characters, under 40 for anything in the round banner region.

### 8.6 Analytics

`question_answered` carries `{ question_id, is_big_one, side, stake, line }` and drops `confidence`. New: `double_placed { question_id, is_big_one, stake }`, `double_skipped { date }` when the tray is left with the double unplaced, `bust_viewed { best }`. `reveal_viewed` gains `delta`.

## 9. Site

`index.html` mirrors the new "The game" and "Your record" claims and drops "The ladder". `play.html`'s "how sure you are" becomes the swipe and the double. `support.html`'s lowest-confidence question is removed. `privacy.html`'s "each answer and its confidence" becomes "each answer and its stake".

## 10. Testing

Core: `stake` at the flat fraction and on the Big One; `doubledStake`; the bust predicate; the rewritten rules pass the vocabulary and claim-budget lints; a tripwire that `CONFIDENCE_FLAT` is on the grid.

API, on PGlite: the seal writes the constant and the flat stake; the double route places once, returns 200 on the same question again and 409 on another, 409 after lock, 404 without a prediction, and the trigger rejects a hand-written stake change; settlement busts a fortune under 100 and not one at 100, stamps `bust_fortune`, resets `run_started_on`, and a re-run does not bust twice; `payFortune` raises `best_fortune` and never lowers it; the ledger's history restarts at the run; the all-time board ranks by best.

Mobile, on node: `sealFlow` without confidence; `trayTiles` and `trayState` across open, locked, placed and partial hands; `doubleNotice` and the notice priority; the reveal's doubled mark, bust block and double observation; the record without the calibration block; the vocabulary lint on the new strings.

Device: the swipe on the simulator through the mobile skill, the tray after the fifth seal, the reveal with a doubled row, and the bust block, each screenshotted.

## 11. Rollout

Amends the launch playbook §2.3: apply `0016` with `0014` and `0015` before the version 3 cutover. No data migration; production has no version 3 rows. The build on the store sends `confidence` and shows the ladder priced at the old fractions; the server ignores the number and stakes flat, so an old client's receipt may disagree with its ladder until it updates. That client is replaced by this build.

## 12. Out of scope

- A right-count duel headline on the reveal (H9).
- Runs as a count, days survived, or a bust count anywhere (H6).
- A rescue purchase (H7).
- The double in practice (H11).
- Deleting `predictions.confidence` and the points and Brier machinery. After the deadline.
- Any change to the Council, the standings, the reading or the evidence.
- The Council-sits pre-noon home state, still parked from the Council design.
