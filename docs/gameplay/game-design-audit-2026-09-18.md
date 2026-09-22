# Outsee game systems audit

September 18, 2026. Read against `main` at `51ce9e3`, version 3 rules (the House and the Hand), with the production database as of 14:00 ET today.

This is an audit of the game as a system of incentives, feedback loops and decisions, not a list of features to add. It rests on three source-level reads (the mobile journey, the economy and settlement code, the content pipeline), four Monte Carlo simulations of the fortune economy, and the live rounds in production. Where a claim comes from code it cites the file. Where it comes from the simulation it says so. Where it is a judgement it is written as one.

## Method and evidence

- Journey: every screen and state in `apps/mobile/src/app`, with the copy in `packages/core/src/copy.ts` and `gameCopy.ts`.
- Economy: `packages/core/src/fortune.ts`, `apps/api/src/resolution.ts`, `apps/api/src/settlement.ts`, the boards in `apps/api/src/routes`.
- Content: `apps/api/src/pipeline`, the exchange feeds, the Council, resolution and push.
- Simulation: 20,000 simulated players per strategy over 30 and 90 days, reimplementing the stake, odds, payout, clamp, ratchet and bust exactly as the code writes them. Scripts are in the session scratchpad; the results are quoted in section C and section E.
- Production: 8 users, 2 of whom have ever sealed a call, 9 predictions in total, 2 rounds ever published. One version 3 round exists, dated today, with zero players at the time of reading. There is no human play under the current rules. Every claim about behaviour below is about the system as built, not observed behaviour.

The one human playtest the specs cite left no artefact in the repo. Seven design decisions rest on it (D11, D12, D13, H2, H3, H5 and the removal of the calibration record). The protocol in `docs/gameplay/playtest-protocol.md` has not run. Treat the playtest as a single anecdote, not evidence.

## A. Product game model

**Player.** One person with a phone, alone. There is no team, no friend graph, no opponent who is a person. The only named characters are the Council members Sonnet, Opus and Haiku, and "the market."

**Goal, as the product states it.** "Make your call. Beat the Oracle's line. Grow your fortune." (`gameCopy.ts:9`). Home says "THE ORACLE · CAN YOU OUTSEE IT?" (`index.tsx:361`).

**Goal, as the system actually scores it.** Fortune, a number that starts at 1,000 and moves with each settled call. Best fortune, its all-time high. Daily return, ranked on a board that needs five players. A streak of days played.

**Core loop.** Every day at noon ET five cards deal. Each shows a question, the Oracle's line, and the money both sides would win. Swipe right for YES or left for NO. The swipe is the seal. After the fifth seal, tap one call to double its stake. Then wait. The reveal opens at the next noon with the Council's readings but no outcomes. Outcomes trickle in as markets settle, typically 27 to 48 hours after the seal, each one a push. When the last one lands, the fortune moves and the ledger writes a row.

```
noon push or reminder
  → five cards, one at a time
  → swipe (stake 5%, Big One 10%)   ← the only decision, five times
  → receipt + crowd verdict for that card
  → tray: place the double            ← the sixth decision
  → crowd finale
  → 23 hours of silence
  → reveal opens at lock: readings, no outcomes
  → outcomes trickle over 4 to 30 hours, one push each
  → hinge push: "YOUR RESULT IS READY"
  → fortune delta, board, share
  → (the next round has been open since noon)
```

**Meta loop.** Fortune grows or busts. A bust under 100 resets to 1,000 and keeps the best. The streak counts days. Five milestones fire in the first week and then nothing. That is the whole meta loop. Nothing unlocks, nothing changes shape, day 30 is identical to day 1.

**Resources.** Fortune (the score), best fortune (the trophy), streak (attendance), streak protection (the only thing money buys), the double (one per round). Practice fortune is inert and correctly so.

**Rewards.** The fortune delta. The line "YOU TOOK THE ORACLE FOR 31" per call. The Council readings, which are the game's one information reward. The daily board rank, when five players exist. Milestones. The share card.

**Progression.** None beyond the number. Calibration and the forecast rating were removed at version 3 (H8, H10), and nothing replaced them as a mastery signal.

**Social system.** The crowd percentage on a question, shown only after the player has sealed it. A daily board by return and an all-time board by best fortune, both silent below five players. A share card. The public standings page ranks the Council members, the market and the crowd, but the app never shows it.

**Key decisions.** Five sides. One double. That is six binary-ish decisions per day, none with a stake size, none with a question choice.

**Current incentive structure.** Right calls pay at the Oracle's odds with no house edge. Being exactly as good as the Oracle has an expected value of exactly zero on every call (`fortune.ts:38-47`; EV(YES)/stake = (p − L)/L). Money is the only score, so every incentive flows through the fortune, and the fortune, as section C shows, rewards three things that are not forecasting: reading the live market, maximising variance, and busting on purpose.

## B. What already works

These are real strengths and the redesign should not touch them.

- **The commitment is real.** The line is committed before open and immutable (`lines_immutable` trigger, `commitLine` write-once). Every question locks at one common noon, and every market must close at least two hours after that lock, so nothing can resolve before anyone stops answering (`draft.ts:152-162`, `select.ts:11`). Crowd data is hidden until the player's own seal, enforced server-side (`round.ts:86-91`). The game's honesty is structural, not a promise.
- **The swipe is the right gesture.** One decision, one motion, no confirm, no undo, with an accessible button path and a reduced-motion fallback (`OracleCard.tsx:187-206`). The receipt and the crowd verdict landing as the next card deals is a tight feedback beat.
- **The money preview teaches the odds without a rulebook.** `STAKE 50 · WINS 31` beside YES and `STAKE 50 · WINS 82` beside NO says everything about a 62% line that a paragraph would (`stakeText.ts:13-16`). This is the best piece of onboarding in the app and it is on every card.
- **The Council reading is a genuine information reward.** Three named models, each with a paragraph, cited evidence and a colour for right or wrong, under each resolved card (`council.ts:34-52`, `CouncilReading.tsx`). Nothing else in the daily-game genre offers "here is what the machine thought, and here is what it read." It is the product's one unique reward and it is currently buried under a disclosure link on the reveal.
- **The house is a collective scoreboard.** "LAST NIGHT THE HOUSE LOST 4,210" and "THE ORACLE OWES ITS PLAYERS 12,004" (`houseLine.ts`) give every player a shared enemy and a shared result. It is a rare case of social feedback that needs no friend graph.
- **Practice is inert and honest.** It uses the real card, the real gesture, and touches nothing (`exhibition.ts`, `PracticeCard.tsx:71`). "Try the other side" is the single best teaching moment in the app.
- **Money cannot buy the board.** Plus buys streak protection and nothing else. `entitlements.plus_active` is read by no route. The promise at `round.ts:358-366` holds.
- **The machine voice.** A consistent, deadpan, tracked-caps register that never uses a call-to-action verb in ambient copy (`copy.ts` header). It is a real identity and it is compatible with humour, which section H uses.
- **The bust as narrative.** "THE HOUSE TOOK IT ALL · BEST 3,410 · A new fortune of 1,000 opens at noon" is the right emotional shape for a loss. The problem in section C is with what it incentivises, not with how it reads.

## C. Friction and broken loops

Ordered by how much they damage the loop, with the screen or file each lives in.

### C1. The game has a dominant strategy, and it is not forecasting

Three code facts compound (`economy` §7.1 to 7.2):

1. There is no vig. A player exactly as good as the Oracle earns zero. Any information edge converts to expected value one for one.
2. The line is stale. `market_prob` is captured once at about 17:00 ET the day before (`draft.ts:188`) and the line committed from it around 09:00. The answering window runs noon to noon. The line is 19 hours old when the window opens and 43 hours old when it closes, and it never moves (`line.ts:23`).
3. The clamp tells you which way it is stale. The line is held within 15 points of that stale market price (`fortune.ts:54-62`). When the Council disagrees by more, the line sits exactly on the band edge. A player who opens Kalshi or Polymarket, which the card links to directly through its SOURCE disclosure (`OracleCard.tsx:230-233`), sees a line 15 points from the price and takes the market side.

Simulated, a zero-skill player who always takes the market side against the line has a median fortune of 6,380 after 30 days and 277,609 after 90, with a bust rate under 0.1%. A player who bets with the house line every time has a median of 590 after 30 days and busts 31.7% of the time.

The game therefore rewards one behaviour above all others: opening another app. That is the opposite of what the card's own copy promises. It also means the interesting question, "do you know better than the Oracle?", has a boring answer: yes, if you look it up.

### C2. Losing is better than winning for most of the fortune's range

The bust resets to 1,000 (`settlement.ts:15-28`). The most a night can remove is 40% of the fortune. So at any fortune from 100 to 163, deliberately losing every call with the double on the Big One guarantees a bust and a net gain of around +850 (`economy` §7.3). More broadly, any fortune below 1,000 prefers a bust to the status quo, and a coin-flip player's median fortune after 30 days is 688, which is inside that range. Tanking is cheap: taking the longest odds on every card busts 98% of players within 36 days from 900.

The Hand spec's intent at H5 was that "a fortune at 40 is dead and the player knows it." The implementation makes 40 the most valuable place on the board. Nothing on Home tells the player they are near a bust (`arrivalState` has no low-fortune branch), so the player who discovers this discovers it from the reveal, after the fact.

### C3. The all-time board rewards variance, not skill

`best_fortune` is a one-way ratchet maintained per prediction (`resolution.ts:96`), never lowered by a bust, and the all-time board ranks on it (`board.ts:25,35`). Upside is permanent, downside is a reset. The optimal strategy has nothing to do with being right: take the longest odds on every card, double the longest, and let the bust catch you. Simulated at zero skill, this triples the 99th-percentile best fortune over plain coin-flipping. Ten free accounts, which cost nothing (`auth.ts:29-56`, five per IP per hour), give a median top best of 7,291 against 1,802 for one. Nobody can read the all-time board as a skill ranking, and once a few players have any real edge the numbers run to nine and ten figures within 90 days, with no cap, no rake and no decay.

### C4. The daily return can be inflated with a clock

`fortune_at_open` is stamped at the first seal (`predictions.ts:75-78`), stakes are cut at each seal, and the previous round settles in the middle of the current window. Seal one card at noon, wait for yesterday's settlement to credit you, seal four more at the larger fortune. The numerator grows, the denominator does not. No skill required.

### C5. The consequence arrives two sleeps after the decision

From a midday seal on day D, nothing happens until the reveal at noon D+1, and that reveal has readings but no outcomes. Outcomes trickle from 14:00 D+1 to as late as 18:00 D+2, and the fortune only moves when the last one lands (`round.ts:203-207`). The typical wait is 27 to 48 hours. Wordle pays in 60 seconds. Kalshi pays when the event happens. Outsee pays two days later at a random hour with a push that has no deep link (`onesignal.ts:33-38`) and quotes a retired currency: "YOU CALLED YES AT 75%. +42." where 75 is the hardcoded `CONFIDENCE_FLAT` and the points number matches nothing on the reveal (`compose.ts:210-216`).

The one structural advantage of this cadence is that day D's result lands while day D+1 or D+2 is open, so a result can hand straight into a decision. The app does not use this. The hinge push says "YOUR RESULT IS READY," opens the last route, and Home has no line that pairs "last night +140" with "today's five."

### C6. The double is a free option, placed with hindsight

The double can be placed any time before the common lock (`predictions.ts:112`), so a player who seals at noon has 24 hours to watch the markets and put it on whichever call has moved their way. H4 calls it "your surest call." The code lets it be your best-informed call, a day later. It also stacks on the Big One to 20% of fortune, which in a zero-vig game is the highest-variance option, and C3 says variance is free. The card screen never mentions that one of the five will be doubled (`OracleCard.tsx` has no such line), so the player cannot factor it into the five decisions it exists to reward.

### C7. Nothing progresses

The five milestones (`milestones.ts:12-19`) fire by the seventh round and are all attendance. Calibration, the forecast rating and the category record were removed at version 3 and nothing replaced them. There is no per-category record, no running count of "right when the Oracle was wrong," no unlock, no reveal of anything new. The Council readings, the one thing that could reward curiosity over weeks, are identical in form every night. Session-to-session progression is a number going up or down.

### C8. The goal is stated once and then never scored on-surface

"Beat the Oracle's line" appears on the first-round rites, which are marked seen before the routing decision (`rites.tsx:125`), so a first-timer on a day with no round reads them once and never again. After that, the reveal headline is a money delta (H9 dropped the duel line on purpose), and no surface shows the player's record against the Oracle over time. The per-call "YOU TOOK THE ORACLE FOR 31" is the closest thing, and it is per call.

### C9. Content repeats and sometimes cannot settle

Selection is volume-greedy with no cross-day memory (`select.ts:51-69`); `market_series_key` is stored and read only by the Council's lessons. Expect Bitcoin, Nasdaq closes and city temperatures most nights. The Big One is the highest-volume market, which is a liquidity measure, not an interest measure. And the selection window admits markets closing up to 30 hours after lock while the void deadline is 24 hours after lock (`select.ts:12` against `state.ts:157-158`), so any market in that six-hour tail is selected and then guaranteed to void. Today's Ethereum question closes at exactly the deadline.

### C10. The Council is currently guessing

In production the evidence table is empty, every reasoning paragraph begins "No evidence was supplied," and Haiku has never committed a line. The readings, the game's one unique reward, are base-rate guesses off the stale market price. This is operational, not design, but the audit has to note that the reward it praises in section B has not yet been delivered to a player.

### C11. The notification contract is broken

The summons promises "UP TO TWO REMINDERS A DAY" (`copy.ts:277`). The system can send five resolution pushes, a hinge push and two local reminders, eight in a day, and five can land in one minute (`onesignal.ts:28`). There is no cap, no batching, no quiet hours.

### C12. Smaller dead ends

- Bust has no Home surface; a busted player who skips the reveal sees 1,000 with no explanation.
- The daily board needs five players. There are two who have ever played. Every board surface reads "THE FIELD IS STILL GATHERING" indefinitely.
- The house line "LAST NIGHT THE HOUSE WON 4,210" with two players is one player's loss with a grand name.
- Ten identical `noon.read-*` push lines mean a returning player sees the same sentence most days.
- Two registers for one failure: "THE ORACLE HAS CLOSED" on the card and "THE ANSWER EXISTS. THIS ONE IS CLOSED." on the banner, for the same 409.

## D. Game-theory findings

### D1. Player versus the line

- Actors: the player; the house (the Council median clamped to a stale market); the exchanges, which are a public, live, better-informed price the app links to.
- Incentives: the player maximises fortune. The house has no incentive at all; it is not a participant, its purse is a number nobody defends.
- Information: asymmetric in the player's favour. The house prices on information up to 43 hours old. The player can see the live price. This is the inverse of every real book.
- Strategies: forecast honestly; or fade the stale line toward the live market; or ignore the question and take whichever side the clamp reveals.
- Likely behaviour: anyone who notices the SOURCE link fades. Everyone else is a coin flipper with negative geometric drift (median 688 after 30 days).
- Equilibrium: the faders own both boards, the house purse bleeds, "the Oracle owes its players" becomes permanent, and honest forecasters cannot compete. Not healthy.
- Mechanism change: price the seal on live information, and give the house an edge or a spread. See E1.

### D2. Player versus the bust

- Actors: the player; the reset rule.
- Incentives: below 1,000, bust. Between 100 and 163, bust deterministically.
- Equilibrium: variance-maximising play at every fortune under 1,000, which is most players most of the time. The bust stops being a narrative event and becomes a strategy.
- Mechanism change: the score must be something a bust cannot improve. See E2.

### D3. Player versus other players on the boards

- Actors: N players, one all-time board by best, one daily board by return.
- Incentives: best is a max over time, so variance and account count both win. Return is a ratio with a manipulable denominator.
- Free riders: multi-accounts (five per IP per hour, no identity check) get N independent tails.
- Signaling: best fortune signals luck plus volume of attempts. It cannot credibly signal skill.
- Equilibrium: a board of longshot farmers and alt accounts. Winner-take-all with no skill component.
- Mechanism change: rank on a rate with a minimum sample, not a stock. See E2.

### D4. Player versus the Council

- Actors: the player, three model members, the market baseline, the crowd.
- This is the one interaction that is well designed: the standings page (`standings.ts`) scores every member by Brier and by house delta at the stakes players actually placed, over the same questions the player answered. The player is the only participant missing from that table.
- Mechanism change: put the player on it. See E3.

### D5. The house versus nobody

The house has no principal. It cannot lose anything it cares about, it cannot adjust its line, and it cannot decline a bet. A game "against the house" where the house is passive is a lottery with a story. Either give the house an edge so its line is worth beating, or stop calling it a house and call it what it is: a rival forecaster whose calls are public.

### D6. Coordination and reciprocity

None exist. There is no way for one player to create value for another, no way to help, share a reading, or invite. The share card is one-way. The crowd percentage after a seal is the only trace of other people. Network effects are zero at present and the daily board's five-player floor means the social surfaces are inert until there are more players than there have ever been.

## E. Opportunity map

Each entry: problem, principle, change, why it should work, downside, mitigation, expected behaviour, metric, size (S/M/L).

### Core loop

**E1. Price the seal on live information, and give the line a spread.**
Problem: C1. Principle: mechanism design; remove the dominant strategy rather than police it. Change, in two tiers. Tier one, cheap: re-read the market at commit (09:00, not 17:00 the day before), narrow the clamp band from 15 to 5 points, and shorten the answering window so the line is never more than a few hours old at lock. Tier two, structural: pay at odds from the live market price at the instant of the seal, and keep the Oracle's line as the rival's opinion rather than the bookmaker's price. The card then reads "THE MARKET 62% · THE ORACLE SAYS 71%. Do you side with the Oracle or against it?" Why: tier one shrinks the edge from +43% to a few percent; tier two removes it entirely, because nobody can fade a price that is the price. Downside: tier two changes the House narrative, and the line stops being one number for everyone. Mitigation: the Oracle's line stays immutable and public as a commitment; only the payout price moves. Expected behaviour: faders lose their edge, honest forecasters' results track their skill. Metric: house delta over 28 days near zero rather than steadily negative; distribution of seals across the window flattens. Size: tier one S, tier two L.

**E2. Score a rate, not a stock.**
Problem: C2, C3, C4, and the multi-account tail. Principle: a score that a bust or an extra account cannot improve. Change: the competitive number becomes return on stake over a rolling 30 days with a minimum of 25 settled calls, shown as a percentage. Fortune stays as the felt number on Home and the record. The all-time board ranks on the rate; best fortune stays on the record as a trophy but ranks nothing. Stamp `fortune_at_open` at the round's open, not the first seal. Why: a rate over a window with a floor has thin tails; tanking lowers it, variance does not raise its expectation, and a second account starts from zero calls. Downside: a rate is less visceral than a number that grows. Mitigation: keep fortune as the hero on Home; the rate is the board's number. Expected behaviour: the suicide window disappears because a bust costs 30 days of rate; longshot play stops paying. Metric: bust rate among players under 1,000; correlation between board rank and Brier. Size: M.

**E3. Put the player on the Council standings.**
Problem: C8, D4, D6, and the five-player board floor. Principle: an always-present field of rivals that does not depend on other humans. Change: the reveal and the record show one table, rows Sonnet, Opus, Haiku, the market, the crowd, and you, ranked by the same rate over the same questions. The record shows "You have been right when the Oracle was wrong N times." The reveal headline returns to a duel: "YOU OUTSAW THE ORACLE" or "THE ORACLE SAW FURTHER," judged on which side each was on. Why: it restores the stated goal as a scored one, gives a full board on day one with zero other players, and makes the Council members characters you are beating rather than a disclosure link. Downside: none structural; the standings query already exists. Mitigation: keep the money delta as the second line. Expected behaviour: players open the reveal to see their rank against named rivals; the reading link gets opened because the rival just beat them. Metric: `reading_opened` per reveal; reveal return rate. Size: S for the table, M for the headline and record.

**E4. Pair the result with the next decision.**
Problem: C5. Principle: a reward should land where the next action is. Change: Home, when yesterday settled and today is open, shows one block: "LAST NIGHT +140 · FORTUNE 1,140" above "TODAY'S FIVE." The hinge push deep-links to the reveal. The push copy drops "AT 75%" and the points figure and quotes the fortune delta. Why: the cadence already overlaps; this makes the overlap the hook. Downside: none. Size: S.

**E5. Show the calls moving.**
Problem: C5 and the 23-hour silence. Principle: continuous feedback on a decision already made. Change: poll the live market price hourly for open questions and show each sealed call's mark-to-market on Home and the round screen: "YOUR YES IS NOW WORTH 61 · IN PLAY +140." Never settle on it; the outcome still settles the call. Why: this is the one honest way to give the game a number that moves between decisions, and it is real data the pipeline already fetches for settlement. Downside: it exposes the live price, which makes E1 mandatory first; and it pulls toward "watching a ticker." Mitigation: ship after E1, and cap the refresh at hourly. Expected behaviour: mid-window opens rise; the app is checked because something changed. Metric: sessions per day between noon and lock. Size: M.

**E6. Lock the double at the finale.**
Problem: C6. Change: the double must be placed before the crowd finale is shown, in the same session as the fifth seal; leaving the tray unplaced forfeits it. Mention it on the first card: "ONE OF THESE FIVE WILL DOUBLE." Why: makes it the "surest call" decision H4 describes. Downside: removes the "unplaced" Home nudge. Size: S.

### Progression

**E7. A record that has shape.**
Problem: C7. Principle: mastery must be visible and specific. Change: per-category record (sports 8 of 12, markets 3 of 9), a count of calls right against the Oracle's side, longest run of right calls, and the Brier over the last 50 calls shown as a plain "accuracy" line. Milestones move from attendance to skill events: first call right when all three members were wrong; ten calls against the tide that paid; a category at 70% over 20 calls. Why: gives a returning player something that grew, not just a number that moved. Downside: category samples are small for months. Mitigation: show counts, not percentages, until 10 calls. Size: M.

**E8. Seasons.**
Problem: C3's inflation and C7's flatness. Change: a monthly season. Fortune persists but the board and the rate reset; the season's winner and the player's own season best are kept on the record. Why: caps inflation, gives a fresh start without a bust, and gives a reason to open the app on the first of the month. Downside: another reset to explain. Mitigation: one line on Home on day one of the season. Size: M.

### Rewards

**E9. Surface the readings before the outcome.**
Problem: C10 and the readings being buried. Change: from lock, before outcomes exist, the reveal leads with the split: "THE ORACLE SAID 71%. SONNET 68, OPUS 75, HAIKU 60. YOU TOOK YES." with the readings open by default on the question the player was most against the Council on. Why: the 23-hour gap gets a payload; the reading is the reward for having committed. Downside: none. Size: S.

**E10. Fix the content engine's reward quality.**
Problem: C9, C10. Change: anti-repetition by `market_series_key` over a 7-day window; prefer earlier closes; drop the selection ceiling to L+22h; choose the Big One by a contested-plus-recognisable score rather than volume alone; get evidence retrieval and the third member actually running. Why: variety is the product's content, and the Big One is its headline. Size: S for the window and repetition, M for the Big One score.

### Social

**E11. One shared question a week.**
Problem: D6. Change: the Sunday Big One is "the week's question," announced Monday, with the crowd split shown after seal as today and the full crowd distribution and reading on the reveal. Share card for that question only. Why: gives every player one common talking point without a friend graph. Size: S.

**E12. Gate the all-time board on identity.**
Problem: C3's alt accounts. Change: Sign in with Apple required for the all-time board, not for play. Size: S.

### Feedback

**E13. Honour the notification contract.**
Problem: C11. Change: batch resolution pushes into one per round ("3 OF 5 DECIDED · +90 SO FAR"), send the hinge as the second, never exceed two server pushes a day, deep-link both. Size: S.

**E14. Bust on Home.**
Problem: C12. Change: when `run_started_on` is today or yesterday, Home carries "THE HOUSE TOOK IT AT 84 · A NEW FORTUNE OF 1,000 · BEST 3,410." Size: S.

### Onboarding

**E15. Fix the rites order and promote "try the other side."**
Problem: C8 and the buried teaching moment. Change: mark rites seen after routing, not before; after the practice result, make "TRY THE OTHER SIDE" the gold button and "PLAY TODAY" the quiet link until both sides have been tried once. Size: S.

### Economy

**E16. Decide the stake fraction on purpose.**
Problem: 5% flat on five cards has a median drift of −1.83% a day at a fair line, −4.04% with the double on the Big One (simulated). Change: either accept that the median player bleeds and the bust is the release valve, or drop to 3% and un-stack the double from the Big One. Why: this is a design call, not a bug, but it should be made knowingly. Size: S.

### Retention

**E17. Nothing artificial.** The streak is already recognition-only at version 3 and streak protection is the only purchase; keep it that way. Retention should come from E3, E4, E5 and E7: a rival to beat, a result that hands into a decision, calls that move, and a record with shape.

## F. Highest-leverage opportunities

Ranked by impact on the fundamental loop against complexity.

1. **E1 tier one**: fresh market read at commit, band 15 → 5, shorter window. Kills most of the dominant strategy in a day's work. (S)
2. **E2**: rate-based standing with a minimum sample; denominator at open. Fixes the bust, the ratchet and the alt-account tail with one metric. (M)
3. **E3**: the player on the Council standings, duel headline back. Restores the goal as a scored thing and gives a full board with zero other humans. (S/M)
4. **E4**: pair last night's result with today's five on Home; deep-link the hinge; fix the push copy. (S)
5. **E9**: readings first, before outcomes, on the reveal. Gives the 23-hour gap a payload. (S)
6. **E6**: double locked at the finale, mentioned on the first card. (S)
7. **E13**: two pushes a day, batched, deep-linked. (S)
8. **E10**: selection window, repetition, evidence, third member. Content quality is the product. (S/M)
9. **E5**: mark-to-market on sealed calls, after E1. The one honest way to make a number move between decisions. (M)
10. **E7**: a record with categories and skill milestones. (M)

None of items 1 to 8 adds a system. Items 1, 2 and 6 remove exploits; 3, 4, 5 and 9 reuse data the app already has.

## G. Experiments

Production has two players, so these are before-and-after measurements with the five-person protocol, not A/B tests.

**G1. Stale line.** Hypothesis: the house delta over 28 days is negative because the line is stale and clamped, not because players forecast well. Change: E1 tier one. Target: all players. Primary metric: house delta per round. Guardrails: seal rate, round completion. Expected: house delta moves toward zero; seals no longer cluster near lock. Falsified if: house delta stays as negative with a fresh line and a 5-point band.

**G2. Rate standing.** Hypothesis: ranking on a 30-day rate removes tanking and longshot play. Change: E2. Primary metric: share of seals on the longer-odds side; bust rate among players under 1,000. Guardrails: daily active players, seals per player. Expected: longshot share falls toward the market's own YES/NO balance; busts under 1,000 fall sharply. Falsified if: longshot share is unchanged.

**G3. Rival table.** Hypothesis: a named field the player is ranked in raises reveal returns and reading opens. Change: E3. Primary metric: reveals opened per settled round; `reading_opened` per reveal. Guardrail: time on reveal (should rise, not balloon). Expected: reading opens at least double. Falsified if: reading opens are flat.

**G4. Result hands into decision.** Hypothesis: showing last night's delta above today's cards raises next-day completion. Change: E4. Primary metric: same-day five-seal completion for players whose previous round settled. Guardrail: none needed. Falsified if: completion is unchanged among that cohort.

**G5. Calls that move.** Hypothesis: mark-to-market adds mid-window sessions without lowering completion. Change: E5, after E1. Primary metric: sessions between noon and lock per player. Guardrails: seal rate at noon, share of seals in the last hour (should not rise). Falsified if: sessions rise only in the last hour, which would mean it is being used to time seals.

**G6. Onboarding.** Hypothesis: players who try both sides in practice can explain the odds. Protocol: the five-person session one, asking "what does WINS 31 mean" after practice. Target: 4 of 5. Falsified if fewer than 3 of 5 can.

## H. Ideal future system

If the systems were redesigned from first principles, keeping everything section B praises:

**1. The ideal core loop.** Every night three machines clock in, read the news, and each posts a number. At noon you get five cards. Each shows the market's live price and the Oracle's number, and asks one question: do you side with the machines or against them? You swipe. The stake is fixed, the payout is the market's, the Oracle's number is a commitment you can see it made. Your sealed calls move with the market all afternoon. At lock the readings open: what each machine thought and what it read. Outcomes settle, and the reveal is a table with six rows, three models, the market, the crowd, and you, ranked by the same rate over the same questions.

**2. The ideal progression.** A rate over a rolling window that a bust cannot improve. A record with shape: categories, the count of calls right when the Council was wrong, the longest run, the Brier as plain accuracy. Milestones on skill events, not attendance. Monthly seasons with a kept season best.

**3. The ideal reward structure.** Information first: the readings, the split, the evidence, delivered at lock before any outcome. Money second: the fortune delta as the felt number. Status third: rank in a table of named rivals. No variable-ratio anything; the world's uncertainty is enough.

**4. The ideal social dynamics.** The Council is the always-present field. The crowd is the second. One shared question a week is the talking point. Other humans are a bonus, never a requirement for the board to exist.

**5. The ideal long-term meta loop.** Seasons cap inflation and give clean starts. The record accumulates across seasons. The Council itself changes: members from different vendors, a silent member that only points, standings that show which machine forecasts the world best. The player's long game is "I am better than these machines at X, and the table proves it."

**6. How the system gets more valuable with investment.** Every settled call adds to a rate, a category record and a history of readings the player has read. The rivals learn too, since the lessons feed back per member, so the contest tightens over time rather than repeating. Nothing accumulated can be bought and nothing is lost to a bust except the run.

### Current loop → recommended loop

```
CURRENT                                     RECOMMENDED
noon: five cards, stale line, no market     noon: five cards, live market price, Oracle's number
swipe at fixed stake, odds from the line    swipe at fixed stake, odds from the market
double any time before lock                 double before the finale, announced on card one
23 hours of silence                         sealed calls move with the market; readings open at lock
outcomes trickle, five pushes, no link      one batched push, deep-linked, fortune delta
reveal: money delta, split under a link     reveal: six-row table, you among the rivals, then money
boards: best fortune (a max), return        board: 30-day rate, min 25 calls, seasons
bust to 1,000 keeps best (a bailout)        bust to 1,000; the rate carries the cost
milestones stop at seven rounds             record with categories, skill milestones
```

The three structural differences: the house becomes a rival rather than a passive bookmaker, so the line is something to beat instead of something to fade; the score becomes a rate rather than a stock, so nothing can be gained by busting, gambling or multiplying accounts; and the gap between decision and consequence gets a payload, first the readings, then the calls moving, so the loop has a middle.

## Remove before adding

- The all-time board by best fortune. Replace, do not decorate.
- The double stacking on the Big One. Un-stack, or cap the double at a normal card.
- The push line "YES AT 75%" and its points figure. Retired currencies should not speak.
- The house line on Home below five players. One player's loss is not "the house."
- Ten byte-identical push strings. Either write ten lines or keep one.
- The 30-hour selection ceiling. It is a void generator.
- The rites "seen" flag firing before routing.

## Operational findings outside the audit's scope

Found in production while grounding the audit. They matter more than anything above this week.

- Only one version 3 round has ever been published, dated today. No rounds exist for September 15, 16 or 17 despite the pipeline being armed on the 15th and voice and taste calls running on each of those evenings. The content report's own read of `market-round.ts:79-95` names one silent-failure path (all-or-nothing category rewriting throwing inside `toDraft` before narration).
- The evidence table is empty. Every Council reasoning paragraph in production begins with a variant of "No evidence was supplied." Either `EXA_API_KEY` is absent or the search is failing silently.
- Haiku has never committed a line. Production lines are Sonnet, Opus and the market only, so the median is a mean of two.
- Two Opus calls on September 16 and 17 returned exactly 8,000 output tokens, which is the ceiling. The bank has zero entries, so the 03:00 bank author is probably truncating and failing.
- Today's slot 4 (Ethereum above $2,400 at noon September 20) closes exactly at the void deadline and will almost certainly void.
