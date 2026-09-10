# The House: the Oracle as market maker

Design, September 10, 2026. Supersedes the question-pipeline-integrity design (2026-09-04) for rounds at rules version 3, and reverses two decisions of the Outsee pass (2026-09-08), each marked below. Amended the same day after the first playtest: D11 to D13, §4.2, §8, §10 and §15.

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
| D11 | The seal is two steps: tap a side, tap a stake rung, tap seal. The pull gesture is retired. | The first playtest found the pull hard to control and asked for two steps. One path for every player also retires the separate accessibility button mode. |
| D12 | The player-facing vocabulary is the Oracle, the house, the line, fortune, stake, the Big One, seal, streak, streak protection, practice and void. Vigil, shield, exhibition, the Rites, ledger, crowd, conviction, standing, epithet and the Oracle rating leave the surface. | The first playtest called the rules confusing and the metaphors a lot to manage. The money words carry the game; the rest were names for ordinary things. |
| D13 | The stake ladder offers five of the nine grid values and shows money, not confidence. | Five rungs are tappable; nine are not. Confidence still records and scores as before, but the playtest could not tell whether it muddied the game, so it is kept out of the way of the stake. |

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
stake(fortune, c, isBigOne) = fortune ≥ 10 ? max(1, round(fortune × fraction)) : max(0, round(fortune × fraction))
```

The floor of one applies from a fortune of ten upward. Below ten the floor is dropped and a zero stake is a valid, unpaid call. Without that rule five floored stakes could sum to a fortune of five and take it to zero.

So 55 stakes one percent, 75 stakes five, 95 stakes nine, and the Big One doubles each. A round with every call at 95 and every call wrong loses 54 percent of the fortune. That is the point.

The app offers five rungs of the grid, 55, 65, 75, 85 and 95, which stake 1, 3, 5, 7 and 9 percent (D13). The core and the API accept the full grid; older rounds and any later client may use it.

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

Pure code, the same greedy spread as `gauntlet/select.ts`: walk candidates by volume, take the highest-volume candidate of each category first, then fill. Four distinct categories required, which is the draft validator's own rule; fewer than five candidates or fewer than four categories falls to the bank. The Big One is the highest-volume selected market. Slots 1 to 4 in volume order.

### 5.4 Voice

One Sonnet 5 call, no web search, effort low. Input: the five exchange titles and rules. Output per question: `text` in the app's question voice and a one-sentence neutral `context`. The call may not change what is being asked. The resolution criteria stored on the question are the exchange's rules verbatim, with the market URL as the source. The Haiku taste gate runs on the five rewritten questions and is the only gate. A taste rejection drops the market and re-selects from the remaining candidates once; a second failure falls to the bank.

### 5.4b Evidence

Retrieval is owned by the pipeline, not by the members. For each selected question, code fetches one **evidence pack** through Exa's search API with `highlights`, a published-date ceiling at the retrieval instant, a floor fourteen days earlier, and `numResults` of eight. `includeDomains` is set to the exchange's stated resolution source when the rules name one, otherwise left open. The query is the exchange title plus the resolution rules. Each item is stored in `evidence` with its URL, title, source domain, published date, and highlight, numbered in rank order.

The published-date ceiling is what makes the September 9 failure structurally impossible: no member can be shown a recap of an earlier meeting of the same teams as if it were this one, and the as-of rule (§14) is enforced by retrieval rather than by instruction.

Every member of the Council receives the same pack. Members reason independently over shared evidence and cite items by number. That is cheaper than one search per member, it makes the standings a comparison of judgment rather than search luck, and it is what a fair tournament looks like: same cards, same evidence, different minds. Council commit calls therefore carry no web search tool at all.

A question whose pack comes back empty still commits; the members are told so. Exa's response reports its own cost; the plan's fixture task records the observed cost per pack and sets the budget line.

### 5.5 Commit

The forecast commit (`forecast` action) becomes the Council commit (§13): every member commits a line on every question, independently, before open. `oracle_p_yes` is the median of the members present. The house line is then derived and stored:

```
line = clamp(oracle_p_yes, max(LINE_MIN, market_prob − LINE_MARKET_BAND), min(LINE_MAX, market_prob + LINE_MARKET_BAND))
```

`questions.line_p_yes` is written once, in the same transaction as the members' lines, and is immutable. A round whose commit misses the deadline opens without a line and without stakes, exactly as a round without a forecast opens without a duel today. Its predictions record confidence and Brier only.

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

Expected calls per night: one voice call, one taste call, five Exa evidence packs, three Council commits with no search tool, and one lesson per model member per settled question (§14). Well under a dollar in model calls; the Exa cost is set from the fixture task.

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

lines                        (§13) question_id, member, p_yes, committed_at, model, prompt_version,
                             reasoning, cited (int[] of evidence ranks), brier, house_delta
                             — primary key (question_id, member)
evidence                     (§5.4b) question_id, rank, url, title, source, published_at, highlight,
                             retrieved_at — primary key (question_id, rank)
lessons                      (§14) id, member, series_key, question_id, text, resolved_at, created_at
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
| `GET /v1/round/:date/reveal` | Adds `council`: one entry per member per question with its line, its `reasoning` paragraph and the evidence items it cited, and `evidence`: the full pack per question. Both only after lock. |
| `GET /v1/standings` | Public, unauthenticated. Per member: calls, Brier, house delta since founding, plus the same figures for the crowd and for the market baseline. Backs the site page and the open dataset (§13.4). |

## 8. Mobile

Every surface keeps its materials, typography and motion. Copy follows the two registers: tracked caps for what is recognised, sentence case for what is read.

### 8.1 Vocabulary

After this release the player sees these names and no others: the Oracle, the house, the line, fortune, stake, the Big One, seal, streak, streak protection, practice, void. Renames:

| Was | Becomes | Where |
| --- | --- | --- |
| The Rites | How to play, as the title, not only the nav label | rules screen |
| Ledger | Your record | record screen, home links |
| Vigil | Streak | record, home ambient lines, Plus |
| Shield | Streak protection; "one free per month" | record, Plus paywall, rescue offer |
| Exhibition | Practice; stamp `PRACTICE · UNRANKED`; waiting-state button `PRACTICE AGAINST THE ORACLE` | practice screen, card, home, rules |
| Summons | Route unchanged; copy says what it is: get told when the Oracle settles | notification interstitial |
| Crowd | Other players in prose; the card back flip is labelled `PLAYERS` | rules, reveal, card back |
| Conviction, standing, epithet, Oracle rating | Removed from the surface. Calibration stays in the record's detail as "your calibration" | round footer, record |

A copy lint in `@oracle/core` fails on any retired word in player-facing copy.

### 8.2 The card and the seal

The pan gesture and the press-and-hold button mode are removed. One path:

1. The card face shows the question and, under it, `THE ORACLE'S LINE · 35% YES`.
2. Below the card, YES and NO. Tapping one leans the card that way with the existing wash and reveals the stake ladder. Tapping the other switches side.
3. The ladder has five rungs (§4.2), each reading `STAKE 50 · WINS 93`, computed by the core preview function at the line for the chosen side, doubled on the Big One. The middle rung is preselected, so the fastest seal is two taps.
4. SEAL commits. The receipt reads `YES · STAKED 50 · WINS 93`. The confidence percent appears nowhere on the ladder or the receipt; it is stored as today and shown only in the record's calibration detail.
5. The card back and crowd flip are unchanged.

Practice uses the same component on the practice fortune and line.

### 8.3 Surfaces

| Surface | Change |
| --- | --- |
| Home | Fortune is the hero number. Beneath it the house line: `LAST NIGHT THE HOUSE LOST 1,240` or `WON`, or `THE ORACLE OWES ITS PLAYERS N` when the purse is negative. Then today's state as now: make your calls, or waiting with the practice button. The one-line streak notice and the streak-protection offer stay on home, because both must be acted on before the lock; the streak's count and the protection reserve live on the record. |
| Reveal | Headline is the round delta and the fortune after: `+140 · FORTUNE 1,140`. Each card shows the side taken, stake, payout, the line and, as context, the market's price. The Oracle comparison reads "you took the Oracle for 93" or "the Oracle took 50"; a void card reads "stake returned". Points, streak and milestone copy move to the expandable detail. Each card leaves a slot under its line for the Council split (§13.3), which the Council plan fills. Rounds at versions 1 and 2 keep their points headline, chosen by the round's rules version. |
| The reading | Under each member's row on the reveal, a collapsed line that opens into the member's paragraph and the evidence cards it cited. Evidence cards use the question card's chrome at smaller scale: title, source, published date, highlight. Uncited items sit under a final "also read" row. Named "the Oracle's reading" in copy. Built by the Council plan. |
| The Council sits (stretch) | Between eleven and noon ET, home shows one row per member flipping to "sealed" as its commit lands, lines hidden. Truthful, since the commits happen then; cut first if time is short. |
| Board | Daily by return as a signed percent, all-time by fortune. Existing eligibility rules and sparse-field states. |
| Record | Fortune history at the top, one row per settled round: date, delta, fortune after. Then the streak with its protection count. Then the calibration record as now, confidence buckets included. |
| Share card | Night realm, unchanged materials. Line one: fortune delta. Line two: the Oracle's line on the Big One and what the player did about it. |
| Practice | Same card and ladder on a fixed practice fortune of 1,000 and the exhibition's fixed line. The result says "practice fortune, nothing changed". |
| Rules | The three-idea introduction: the Oracle posts its line on five questions a day; take a side and stake part of your fortune; right calls pay at the Oracle's odds, wrong calls lose the stake. The full rules shrink from six sections and about forty claims to four and about twenty: the game, results and the board, your record, timing and fairness. The stake ladder appears as a five-row table. Versions 1 and 2 rules stay in the archive, linked from those reveals. |

## 9. Analytics

Existing events gain `stake`, `line`, `delta` properties where a prediction or reveal is already tracked. One new event: `house_headline_viewed` with the sign of last night's house delta. No new provider.

## 10. Testing

- Core: stake ladder at every grid value with and without the Big One; payout for both sides at the clamp bounds and at 50; delta sums to zero across a settled question when every prediction is aggregated with the house; return with a fortune change mid-window; a negative control proving no path lets fortune reach zero.
- Feeds: recorded fixtures from both exchanges captured on September 10; eligibility window at the boundaries; one-per-event rule; category mapping for every known Kalshi category; a night with four candidates falls to the bank.
- Settlement readers: fixtures for settled YES, settled NO, cancelled, and still-open on both exchanges; a retried settle pays nobody twice.
- API: seal → settle → fortune on a version 3 round; a seal on a lineless question is rejected; version 2 rounds settle exactly as before.
- Mobile: card line and the ladder at all five rungs with and without the Big One; the two-step state machine including a side switch before seal; reveal headline for win, loss and void, chosen by rules version; house headline for the negative purse; practice never posts a stake; the retired-word lint; the rules claim count.
- Council: median with an even and odd number of members; an abstaining member is excluded from the median and scored nothing; a member whose response fails to parse abstains rather than defaulting to 50; per-member Brier and house delta over a settled round; the market baseline member is never sent to a model.
- Evidence: a pack is retrieved once per question and shared; every item's published date is at or before the retrieval instant; a member's cited ranks all exist in the pack; an empty pack still commits.
- Lessons: a lesson is written only after settlement; the as-of filter excludes a lesson whose outcome was not known at commit time; caps hold; a member never receives another member's lessons.
- The full suite runs under the existing timing note: about six and a half minutes, bare 5,000 ms timeouts are contention.

## 11. Rollout

1. Apply `0010` to production before deploying the API. Set the `EXA_API_KEY` secret.
2. Deploy the API.
3. Arm the pipeline: set `PIPELINE_ENABLED` to true. This comes BEFORE the
   manual deal, because the admin authoring and forecast routes are pipeline
   routes and answer 503 while the flag is unset. Arming early is safe: the
   cron only acts inside its scheduled hours, so it does nothing until the next
   forecast, publish, authoring or settle hour arrives.
4. Run the market authoring once by the admin route against tomorrow's date,
   then forecast and line it, and inspect the draft in Telegram. The first
   version 3 round publishes at the next noon.
5. Delete the retired `oracle-probe` Workflow from the Cloudflare account
   (`npx wrangler workflows delete oracle-probe`). Version 3 has no probe and
   nothing binds it any more.
6. Ship the mobile build. Version 2 rounds already settled remain readable.
   Until the mobile plan ships, the build on the store renders a version 3
   daily board empty — 0 points, null comparisons — because it reads fields a
   version 3 round no longer carries. Parsing is safe.
7. The production database holds one player. Their fortune starts at founding.

## 12. Alignment with forecasting research

The Forecasting Research Institute and Metaculus tournaments score forecasters on proper rules over well-specified questions. This design keeps both properties beneath the surface and makes the game a better funnel for them than it was:

- Every question is an exchange-specified event with published rules and a public price. Player forecasts are directly comparable to a real market and to the Oracle, which is the comparison that research program studies.
- Confidence and Brier are recorded on every prediction, unchanged. The calibration ledger stays a proper record. The fortune is the incentive to keep making calls.
- A player's record, expressed as calls, Brier and calibration by bucket, is exportable in a later release as "your forecasting record". That is the offer to a tournament: a stream of people who already make daily, timestamped, resolved forecasts against market prices.

The pitch writes itself as "the daily game that finds forecasters". Nothing in this spec is required for that pitch beyond what the game needs anyway.

## 13. The Council

The line commit is plural, independent and publicly scored. A **member** is anything that commits a probability on every question of a round before the round opens and is scored on the outcome by the same rule as every other member.

### 13.1 Members at launch

| Member | What it is | Cost per night |
| --- | --- | --- |
| `sonnet` | Claude Sonnet 5, forecast prompt over the shared evidence pack (§5.4b), no search tool | one call |
| `opus` | Claude Opus 5, same prompt and pack | one call |
| `haiku` | Claude Haiku 4.5, same prompt and pack | one call |
| `market` | The exchange price at selection time, verbatim | none |

Three models is the smallest set that gives a median a meaning. The market member is the baseline every other member is measured against and is never sent to a model. Membership is a static table in code; adding a member is one row and, for a model member, one prompt-version string.

### 13.2 Commit and the house line

Each model member commits in its own workflow step so a failure or timeout in one does not lose the others. A member that fails, times out, or returns a probability that does not parse **abstains** for that question: no row, no score, and it is excluded from the median. The house line is the median of the members present, clamped to the market band (§5.5). If fewer than two members are present on any question the round opens unstaked (§5.5), and that is alerted.

Every member's line is written to `lines` in the same transaction as `questions.line_p_yes`, with `committed_at`, the model id, the prompt version, a one-paragraph `reasoning` in plain prose, and the evidence ranks it cited. Rows are immutable. The reasoning is the member's stated route from the evidence to its number, requested as a field of the structured output; it is not a chain of thought and is never presented as one. The existing commitment snapshot on `rounds` keeps recording the round-level facts.

### 13.3 What players see

Before the seal: the house line only. Members' lines are not shown until the round locks, because the split is information and the house is the one line the player plays against.

At the reveal, under each card's line: the split, one row per member, in a fixed order. "Sonnet 40 · Opus 31 · Haiku 44 · Market 35 · The Oracle's line 35." Each member's row carries its outcome for that question in the same win/loss colour the player's own call uses.

### 13.4 Standings and the open record

`GET /v1/standings` returns, for each member and for the crowd, the number of scored calls, mean Brier, and house delta since founding, computed over settled version 3 questions. House delta for a member is what the purse would have done had that member's line been the house alone, using the actual stakes players placed. It is the same aggregate as `rounds.house_delta`, with the member's line substituted.

The site gains one page, `/standings`, that renders the table and a one-line explanation of the rule. The same route, with `?format=csv`, returns one row per settled question and member: date, slot, question text, market id, market price at selection, member line, house line, crowd yes percent, crowd count, outcome. This is the open record. It contains nothing about any individual player.

The standings page is the public proof that the man-versus-machine claim is true, and the dataset is the artefact offered to forecasting-research partners (§12).

### 13.5 Members to come

None of these are built in this release; the table shape is what admits them.

- **Seers.** Players in the top decile of the calibration ledger over a minimum number of calls earn a pre-open window in which they commit lines like any other member. On a round where a player is a Seer, they are the house, not a player: their lines are scored as a member and they place no stakes. The house line stays a median, so a single Seer cannot move it far.
- **Visitors.** An external forecaster, human or model, that commits lines through an authenticated route before the commit deadline, scored identically. This is how another lab enters the arena.

## 14. Memory

Taken from TradingAgents' decision log rather than its agent graph. The mechanism is small: store the decision now, reflect once when the outcome is known, and feed a few short lessons back into the next prompt with a strict as-of rule so nothing learns from the future.

### 14.1 Rule

- At settlement of a question, for each model member that committed a line on it, one Haiku call writes a lesson: two to four sentences of plain prose stating whether the line was on the right side of the outcome, what in the reasoning held or failed, and one concrete adjustment for the next question in the same series. Written once, keyed on `(member, question)`, never rewritten.
- `series_key` is the exchange's recurring series when one exists (Kalshi series ticker such as `KXHIGHNY`, Polymarket event tag), otherwise the question's category.
- Before a member commits, its prompt receives at most the five most recent lessons from the same `series_key` and the three most recent from any other, **each with an outcome known before the moment of commit**. A lesson whose `resolved_at` is later than the commit instant is never included. This is the as-of rule and it is what keeps the standings honest and any later replay free of look-ahead.
- A member receives only its own lessons. Sharing lessons across members would correlate their errors, and the median depends on them being independent.
- Lessons are stored in `lessons` and are readable from the admin route, so a bad lesson can be found and deleted by hand. The lessons a member received before a commit are recorded on its `lines` row by id, so the reading can show what the member remembered as well as what it read.

### 14.2 What this buys

Recurring series are where a fixed prompt loses to a market: the same NYC high-temperature question every day, the same weekly game markets, the same monthly prints. A member that has learned "the NWS forecast high has run two degrees warm this month" from its own record has an edge the market may not, and that edge is exactly the kind of disagreement the line band permits. The cost is one Haiku call per member per settled question, about a tenth of a cent.

### 14.3 Not taken

TradingAgents' bull and bear researcher debate, its four-analyst fan-out and its portfolio-manager approval step are not taken. Each multiplies calls, and the debate correlates the participants' errors. The Council's median over independent members gets the diversity benefit at one call per member. Its `REVIEW`-not-`Hold` rule for an unparseable decision is already the Council's abstention rule.

## 15. Out of scope

- A moving line as players stake. The line is fixed at commit. Manifold's automated market-maker math is the reference if this ever changes.
- Debate between Council members before committing. Independent lines and a median give the diversity without the rounds of calls; a debate would also correlate the members' errors, which is the thing the median exists to exploit.
- Player members and external members of the Council. The table shape admits them (§13.5); nothing in this release builds them.
- A named currency. Fortune is unit-less by design.
- Fortune leaderboards across friends, seasons or resets.
- Kalshi or Polymarket as a source for the bank. The bank stays evergreen and authored.
- Adopting an agent-UI component library. The reading takes the expandable-trace and evidence-card patterns and renders them in the app's own materials.
- A hand-of-predictions card game with modifiers and head-to-head play, raised in the first playtest. The Council split at reveal is the nearest thing this release builds.
