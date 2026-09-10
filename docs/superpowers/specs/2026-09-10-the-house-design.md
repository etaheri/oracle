# The House: the Oracle as market maker

Design, September 10, 2026. Supersedes the question-pipeline-integrity design (2026-09-04) for rounds at rules version 3, and reverses two decisions of the Outsee pass (2026-09-08), each marked below.

## 1. The problem this solves

The game has no stakes. Points only go up, the Oracle is a commentator with nothing to lose, and "can you outsee it" carries no weight. Prediction markets are compelling because being right when others were wrong costs someone something. Wordle is compelling because everyone faces the same puzzle and the result is shareable. The game already has the second. This design adds the first, on brand: the Oracle is the house.

Two operational failures of the current pipeline are resolved by the same change rather than patched. First, the in-window probe voided a live question on September 9 because a model with no date anchor read a recap of an earlier 49ers–Rams game as the answer. Second, the authoring gauntlet re-ran six times in one evening, burning roughly four dollars of model calls to publish nothing. Both go away when questions come from exchanges with a known close and a machine-readable settlement.

## 2. The game in one paragraph

Every day at noon ET the Oracle deals five cards. Each card is a live real-money market from Kalshi or Polymarket, rewritten in the Oracle's voice, and on each card the Oracle has posted its line: its own probability of YES. The player picks a side and a confidence, exactly as today. Confidence sets the stake, a fraction of the player's fortune. A right call pays at the Oracle's odds. A wrong call loses the stake. The Oracle's purse is public. The daily headline is whether the house won or lost last night.

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Questions come from Kalshi and Polymarket markets, not from the authoring model. | Known close instant, machine-readable settlement, every question has a real-money price. Kills the leak class and the model resolver. |
| D2 | The Oracle posts a line before open and the line is shown on the card before the seal. **Reverses** the Outsee pass rule "no advance Oracle reveal". | A house must post its line. "The Oracle says 35 percent. Do you know better?" is the better question. |
| D3 | The line is clamped to within 15 points of the market price at commit. | A miscalibrated night cannot be farmed. The Oracle may still disagree with the market, which is its personality. Tunable. |
| D4 | Fortune is the only number on home, reveal, board and share. Points, rating and the calibration ledger stay underneath as the judgment record. | One currency on the surface. The Brier record remains the scientifically proper measure and the basis for the forecasting-research pitch (§12). |
| D5 | Stakes are proportional to fortune, so fortune can fall hard but never reaches zero. | No stipend, no bankruptcy state, no purchasable fortune. |
| D6 | No vig at launch. | A house margin makes casual players bleed and there are no players yet. |
| D7 | Fortune is never sold, granted or protected by Oracle Plus. | Keeps the app clear of simulated-gambling and loot-box rules. Plus stays streak protection and cosmetics. |
| D8 | Fortune carries no vigil, first-hour or contrarian multiplier. The Big One doubles the stake fraction and nothing else. | The market odds already reward a correct contrarian call. Multipliers on money are hard to explain and easy to distrust. |
| D9 | Fewer than five eligible markets on a night publishes a bank round under the existing rules, with an alert. | One fallback path, already built, already tested. No hybrid rounds. |
| D10 | Rounds at version 3 use this design. Versions 1 and 2 keep their rules. | Same posture as the version 2 cut. Production holds one player, so no fortune migration is needed. |

## 4. Stakes, odds and fortune

All fortune arithmetic lives in `@oracle/core` as pure functions with no I/O, beside the existing `scoring.ts`.

### 4.1 Constants

```
FORTUNE_FOUNDING       = 1000   // every player's starting fortune
STAKE_FRACTION_MAX     = 0.10   // ⚙ tunable; fraction of fortune at confidence 100
LINE_MARKET_BAND       = 0.15   // ⚙ tunable; the line may sit this far from the market price
LINE_MIN               = 0.05
LINE_MAX               = 0.95
HOUSE_FOUNDING         = 0      // the purse is reported as a running total since founding
```

### 4.2 Stake

Confidence `c` is the existing grid, 55 to 95 in steps of 5.

```
fraction(c, isBigOne) = ((c − 50) / 50) × STAKE_FRACTION_MAX × (isBigOne ? 2 : 1)
stake(fortune, c, isBigOne) = max(1, round(fortune × fraction(c, isBigOne)))
```

So 55 stakes one percent, 75 stakes five, 95 stakes nine, and the Big One doubles each. A round with every call at 95 and every call wrong loses 54 percent of the fortune. That is the point.

The stake is computed from the fortune **at the instant of the seal** and frozen on the prediction. Fortune changes only at settlement, so a round's five stakes share one base unless an earlier round settles mid-window, in which case later seals use the updated fortune. Nothing is debited at seal.

### 4.3 Odds and payout

`line` is the Oracle's committed probability of YES.

```
odds(answer, line) = answer ? (1 − line) / line : line / (1 − line)
payout(stake, answer, line, outcome):
  outcome = "void"        → stake            // returned
  outcome matches answer  → stake + round(stake × odds(answer, line))
  otherwise               → 0
delta = payout − stake
```

Taking YES at a 35 percent line pays 1.86 times the stake on top of the stake. Taking NO at the same line pays 0.54 times. Because the line is clamped to `[LINE_MIN, LINE_MAX]` and selection admits only markets priced between 20 and 80 percent, the largest possible multiple is 19 and in practice under 5.

### 4.4 Fortune

```
users.fortune starts at FORTUNE_FOUNDING
at settlement of each prediction: users.fortune += delta
```

The purse:

```
house delta for a round = Σ over that round's settled predictions of (stake − payout)
house total = HOUSE_FOUNDING + Σ over rounds of house delta
```

The purse may go negative. The copy for that state is "the Oracle owes its players N".

### 4.5 Return on the day

For the daily board:

```
return = Σ delta / fortune at the player's first seal of the round
```

`user_rounds.fortune_at_open` is written at the first accepted seal and never rewritten. A new player with 1,000 and a veteran with 40,000 compete on equal terms on the daily board. The all-time board ranks by fortune.

### 4.6 What the confidence grid means now

The player still reports confidence in the outcome, not confidence in beating the line. The stake ladder is a function of confidence alone, which keeps the card honest and explainable: the surer you are, the more you stake. The Brier score recorded beside every prediction is unchanged and remains a proper scoring rule. The fortune is the game. The Brier ledger is the science. Both are stored on the same row.

## 5. The nightly pipeline

One run at 17:00 ET, dispatched by the existing cron and workflow substrate. No hourly retry. A failed run alerts and the noon fallback is the bank (D9).

### 5.1 Feeds

`feeds.ts` already defines `MarketFeed` and implements Manifold and Polymarket. This design retires Manifold as a question source (play money, creator-resolved) and adds Kalshi. Each feed returns `MarketCandidate`:

```
interface MarketCandidate {
  source: "kalshi" | "polymarket";
  marketId: string;         // Kalshi ticker; Polymarket market id
  eventKey: string;         // Kalshi event_ticker; Polymarket event slug — one question per event
  title: string;            // exchange title, verbatim
  rules: string;            // Kalshi rules_primary; Polymarket description
  url: string;
  category: Category;       // mapped from Kalshi event category / Polymarket tags
  prob: number;             // Kalshi mid of yes_bid_dollars/yes_ask_dollars; Polymarket outcomePrices[0]
  volume: number;           // real-money volume in USD-equivalent
  closesAt: string;         // ISO; Kalshi close_time; Polymarket endDate
}
```

Kalshi's public endpoint `GET https://api.elections.kalshi.com/trade-api/v2/markets?status=open&max_close_ts=…` returns prices without a key in the `*_dollars` fields. The earlier note that Kalshi nulls prices without a key was reading the retired cent-denominated fields. Verified September 10: roughly 15,000 open markets closing within 48 hours, 91 series with a contested market above 1,000 volume, including NYC and Chicago high temperature, Dallas rain, August CPI, Bitcoin and Nasdaq closes, presidential approval and a Big Brother elimination. Polymarket's `gamma-api.polymarket.com/markets` needs a browser user agent and paginates at 100. The same day it held 17 distinct contested events above 3,000 volume, mostly sports and economics.

Category mapping is a static table keyed on Kalshi `event.category` and Polymarket tags, falling back to `news`. Unknown series are admitted, not rejected.

### 5.2 Eligibility

For round date `D` with lock `L = noon ET on D+1`:

```
closesAt ∈ [L + 2h, L + 30h]
0.20 ≤ prob ≤ 0.80
volume ≥ 5000 (Polymarket USD) / 5000 (Kalshi contracts × price)   ⚙ tunable
one market per eventKey: the highest-volume market whose title does not begin with "Spread" and does not contain "O/U"
```

The lower bound on `closesAt` is the leak rule. A market whose trading closes at least two hours after the lock concerns an event that begins after the lock. This is what excludes the 49ers game from the round that opens the afternoon before kickoff, and what excludes today's high temperature in favour of tomorrow's. The upper bound keeps settlement inside the following evening so the reveal is never two days late.

### 5.3 Selection

Pure code, the same greedy spread as `gauntlet/select.ts`: walk candidates by volume, take the highest-volume candidate of each category first, then fill. Five distinct categories preferred, three accepted, fewer than five candidates falls to the bank. The Big One is the highest-volume selected market. Slots 1 to 4 in volume order.

### 5.4 Voice

One Sonnet 5 call, no web search, effort low. Input: the five exchange titles and rules. Output per question: `text` in the app's question voice and a one-sentence neutral `context`. The call may not change what is being asked. The resolution criteria stored on the question are the exchange's rules verbatim, with the market URL as the source. The Haiku taste gate runs on the five rewritten questions and is the only gate. A taste rejection drops the market and re-selects from the remaining candidates once; a second failure falls to the bank.

### 5.5 Commit

The existing forecast commit (`forecast` action, `rounds.oracle_*` columns) runs unchanged and produces `oracle_p_yes` for each question. The line is then derived and stored:

```
line = clamp(oracle_p_yes, max(LINE_MIN, market_prob − LINE_MARKET_BAND), min(LINE_MAX, market_prob + LINE_MARKET_BAND))
```

`questions.line_p_yes` is written once, in the same transaction as the commit, and is immutable. A round whose commit misses the deadline opens without a line and without stakes, exactly as a round without a forecast opens without a duel today. Its predictions record confidence and Brier only.

### 5.6 Settlement

The existing hourly `resolve` action, after lock, reads the exchange instead of asking a model:

| Source | Read | Settled when | Outcome |
| --- | --- | --- | --- |
| Kalshi | `GET /trade-api/v2/markets/{ticker}` | `status` is `settled` or `finalized` | `result` `yes` → YES, `no` → NO, anything else → void |
| Polymarket | `GET /markets/{id}` | `closed` and `umaResolutionStatus` is `resolved` | `outcomePrices[0]` `"1"` → YES, `"0"` → NO, anything else → void |

The exact field names and values are confirmed against recorded fixtures in the first plan task; this table states intent, not verified API contract. An unsettled market stays locked and is retried hourly. The void deadline of noon ET two days after the round date is unchanged. `resolution_evidence` stores the raw exchange record.

Settlement of a question runs the existing `resolveQuestion` path, then computes `payout` and `delta` for each prediction, writes them, and adds `delta` to `users.fortune` in one statement per prediction, claimed with the same `WHERE settled_at IS NULL RETURNING` pattern as the resolution push so a retried tick pays nobody twice. `rounds.house_delta` is written by aggregate when the last question settles.

### 5.7 Retired

For version 3 rounds: `gauntlet/generate`, `screen`, `sources`, `critic`, `preflight`, `editorial`, `probe.ts`, `leak.ts`, the model resolver, and the hourly authoring retry. Bank authoring and bank resolution keep the model paths, and the resolver prompt gains the current instant and the question's open instant with the instruction that evidence dated before the open instant is a different event. That is the only change to the retained model path.

Expected model calls per night: one voice call, one taste call, one forecast commit. Roughly one cent.

## 6. Schema

Migration `0010`, additive:

```
users.fortune                integer not null default 1000
predictions.fortune_at_seal  integer
predictions.stake            integer
predictions.line_p_yes       numeric          // frozen copy at seal
predictions.payout           integer
predictions.settled_at       timestamptz
questions.line_p_yes         numeric
questions.market_source      text             // "kalshi" | "polymarket"
questions.market_id          text
questions.market_event_key   text
questions.market_closes_at   timestamptz
rounds.house_delta           integer
user_rounds.fortune_at_open  integer
```

`CURRENT_RULES_VERSION` becomes 3. Version 3 rounds require `line_p_yes` on every question at publish, or the round opens unstaked (§5.5).

## 7. API

| Route | Change |
| --- | --- |
| `GET /v1/round/today` | Each question carries `line_p_yes`. Response carries `fortune` and `house` (total since founding, last round's delta). |
| `POST /v1/predictions` | Computes and stores `fortune_at_seal`, `stake`, `line_p_yes`. Writes `user_rounds.fortune_at_open` on the first seal. Rejects a stake on a question without a line as today it rejects a prediction on a locked question. |
| `GET /v1/round/:date/reveal` | Per question: `stake`, `payout`, `delta`, `line_p_yes`, `market_prob`, crowd. Round: `delta`, `return`, `fortune_after`, `house_delta`. Points remain in the payload for the ledger. |
| `GET /v1/round/:date/board` | Daily rows ranked by `return`. Adds an all-time mode ranked by `fortune`. Eligibility rules unchanged. |
| `GET /v1/me/ledger` | Adds `fortune`, `fortune_history` (one entry per settled round: date, delta, fortune after). Calibration buckets unchanged. |
| `GET /v1/round/exhibition` | Practice runs on a fixed practice fortune of 1,000 and a fixed line, never touching the user's fortune. |

## 8. Mobile

Every surface keeps its materials, typography and motion. Copy follows the Outsee register: ordinary words for actions and numbers, the inscription voice reserved for the Oracle.

| Surface | Change |
| --- | --- |
| Card face | Below the question, one line: `THE ORACLE'S LINE · 35% YES`. |
| Conviction column | The readout adds `STAKE 42 · PAYS 78` computed from the live confidence via the core preview function. Replaces the points payoff line. |
| Seal | Unchanged gesture. Receipt reads `YES AT 70 · STAKED 42`. |
| Card back | Crowd flip unchanged. |
| Home | Fortune is the hero number. Beneath it the house line: `LAST NIGHT THE HOUSE LOST 1,240` or `WON`. |
| Reveal | Headline is the round delta and the fortune after. Each card shows stake, payout, the line and, as context, the market's price. The Oracle comparison becomes "you took the Oracle for N" or "the Oracle took N". Points, streak and milestone copy move to the expandable detail. |
| Board | Daily by return, all-time by fortune. |
| Ledger | Fortune history above the calibration record. |
| Share card | Night realm, unchanged materials. Line one: fortune delta. Line two: the Oracle's line on the Big One and what the player did about it. |
| Practice | Uses the exhibition fortune and line; copy says so. |
| Rules | The three-idea introduction becomes: the Oracle posts a line, you take a side and a stake, right calls pay at the Oracle's odds. Full rules gain the stake ladder table. |

## 9. Analytics

Existing events gain `stake`, `line`, `delta` properties where a prediction or reveal is already tracked. One new event: `house_headline_viewed` with the sign of last night's house delta. No new provider.

## 10. Testing

- Core: stake ladder at every grid value with and without the Big One; payout for both sides at the clamp bounds and at 50; delta sums to zero across a settled question when every prediction is aggregated with the house; return with a fortune change mid-window; a negative control proving no path lets fortune reach zero.
- Feeds: recorded fixtures from both exchanges captured on September 10; eligibility window at the boundaries; one-per-event rule; category mapping for every known Kalshi category; a night with four candidates falls to the bank.
- Settlement readers: fixtures for settled YES, settled NO, cancelled, and still-open on both exchanges; a retried settle pays nobody twice.
- API: seal → settle → fortune on a version 3 round; a seal on a lineless question is rejected; version 2 rounds settle exactly as before.
- Mobile: card line and stake readout at three confidences; reveal headline for win, loss and void; house headline for the negative purse; practice never posts a stake.
- The full suite runs under the existing timing note: about six and a half minutes, bare 5,000 ms timeouts are contention.

## 11. Rollout

1. Apply `0010` to production before deploying the API.
2. Deploy the API with `PIPELINE_ENABLED` still false. Run the market authoring once by the admin route against tomorrow's date and inspect the draft in Telegram.
3. Arm the pipeline. The first version 3 round publishes at the next noon.
4. Ship the mobile build. Version 2 rounds already settled remain readable.
5. The production database holds one player. Their fortune starts at founding.

## 12. Alignment with forecasting research

The Forecasting Research Institute and Metaculus tournaments score forecasters on proper rules over well-specified questions. This design keeps both properties beneath the surface and makes the game a better funnel for them than it was:

- Every question is an exchange-specified event with published rules and a public price. Player forecasts are directly comparable to a real market and to the Oracle, which is the comparison that research program studies.
- Confidence and Brier are recorded on every prediction, unchanged. The calibration ledger stays a proper record. The fortune is the incentive to keep making calls.
- A player's record, expressed as calls, Brier and calibration by bucket, is exportable in a later release as "your forecasting record". That is the offer to a tournament: a stream of people who already make daily, timestamped, resolved forecasts against market prices.

The pitch writes itself as "the daily game that finds forecasters". Nothing in this spec is required for that pitch beyond what the game needs anyway.

## 13. Out of scope

- A moving line as players stake. The line is fixed at commit. Manifold's automated market-maker math is the reference if this ever changes.
- Multi-agent forecasting for the Oracle's line. The pattern from TradingAgents is one prompt away and multiplies calls.
- A named currency. Fortune is unit-less by design.
- Fortune leaderboards across friends, seasons or resets.
- Kalshi or Polymarket as a source for the bank. The bank stays evergreen and authored.
