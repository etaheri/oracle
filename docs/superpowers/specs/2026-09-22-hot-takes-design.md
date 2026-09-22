# Hot takes: the machines predict the players

Design, September 22, 2026. Amends the House design (`2026-09-10-the-house-design.md`) at §5 and §7, and the Hand design (`2026-09-14-the-hand-design.md`) at §5.1, for the Shipaton week. Written against `main` at `51ce9e3` after the game systems audit (`docs/gameplay/game-design-audit-2026-09-18.md`) and the one-pager shared with Aidan. Where this document and the House or Hand specs differ, this one is current. Everything not named here is unchanged.

## 1. The problem this solves

The audit found three things. The questions are what traders bet on, not what people want to know. The outcome is a real-world event, so the result arrives one to two days after the seal as a trickle of pushes with no moment. And the Oracle's line is a clamped copy of a market price, so the winning strategy is to look the price up. Underneath all three: forecasting the future is not the verb this team loves, and there are eight days to the submission.

This design keeps every surface and every mechanic and changes what the questions are about. The questions become opinions. The outcome becomes the players' own majority. The Oracle's job becomes predicting what the room will say.

## 2. The game in one paragraph

Every day at noon ET the Oracle deals five hot takes. Swipe right for YES, left for NO; the swipe is the seal, and nothing about the room is shown before it. After the seal you see how the players are leaning so far and what the Oracle expected. At the next noon the round locks and each question resolves on the majority of the players who answered it. The reveal shows the room's final share, whether you were with the majority, each Council member's guess in gold or red, and the paragraph where it explains why it thought most of you would say no. The standings rank the machines by how well they read people.

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| T1 | Rules stay at version 3. No version 4. | Every version 3 surface (fortune reveal, boards, standings, stakes) renders an opinion round unchanged. A new version would fork forty readers for a week's work. |
| T2 | A crowd-resolved question is marked `market_source = 'crowd'`, with `market_id` the round date, `market_event_key` the question slot, and `market_closes_at` the lock. | The resolver already branches on `market_source`; `modelIds` already excludes any question with one, so the two-model resolver never touches these; no migration. A dedicated column would be cleaner and can follow the week. |
| T3 | The round kind is a Worker var, `PIPELINE_ROUND_KIND`, `opinion` or `market`, default `opinion` once deployed. | One switch, one deploy, and the market round stays available. |
| T4 | Opinion questions are authored by one Sonnet call, one per category for slots 1 to 4 and the Big One in any category, then the taste gate as now. No context block, no evidence retrieval. | The draft schema demands four distinct categories and the Big One in slot 5; the categories become a constraint that makes the five varied. Evidence is meaningless for an opinion, and skipping it saves the five Exa searches. |
| T5 | The Council's prompt for a crowd question asks for the share of players who will answer YES, with reasoning shown as written. The line is the median, unclamped. | `clampLine` already returns the bare median when the market is null. The reasoning is the product. |
| T6 | The outcome is YES when more than half of the sealed answers are YES, NO when fewer than half, void on an exact tie or when fewer than `CROWD_RESOLVE_MIN` players sealed it. `CROWD_RESOLVE_MIN` is 1 this week. | A majority is the honest reading of "what the room said." An exact split is a void, not a coin. The floor rises to 20 once there are twenty players; it is a constant. |
| T7 | Every crowd question resolves on the first resolve tick after lock, together. The per-question resolution push is suppressed for crowd questions; only the hinge push fires. | Five outcomes at once means five pushes in one minute. One push saying the result is ready is the contract the summons promises. |
| T8 | Scoring, stakes, the double and the bust are unchanged. A right call is a call on the majority side, paid at the line's odds. | The money machinery keeps running so nothing on the reveal, boards or record needs rework. The audit's economy findings stand and are October's. |
| T9 | Build 12 hides the Oracle's estimate and the money preview until after the seal, and swaps the bookmaker strings for room-reading ones. | Shown before the seal, the estimate is a common signal: players follow it to match the majority, the crowd converges on it, and the machine is right by construction. Hidden, the game is a beauty contest between you and the machine, which is the game. |
| T10 | Practice keeps drawing from resolved rounds, so it becomes a past hot take. The fictional fallback stays. | Nothing to change; the exhibition route already reads resolved rounds. |
| T11 | Deferred: an Oracle remark on the reveal, a crowd floor of 20, a 7 PM lock, fortune's removal, the inspector reskin. | Each is a build or a design decision; none is needed for the week. |

## 4. Authoring

`apps/api/src/pipeline/opinion-round.ts`, new, alongside `market-round.ts`. `decideActions` still emits `author` at 17:00 ET and `AuthoringWorkflow` still runs its four steps. The `candidates` step returns an empty pool when `PIPELINE_ROUND_KIND` is `opinion`, the `draft` step calls `buildOpinionDraft` instead of `buildMarketDraft`, and `commit` and `narrate` are shared.

### 4.1 The prompt

One structured call, `PIPELINE_VOICE_MODEL` (Sonnet 5), no web search, effort low. The system prompt states:

- Write five yes-or-no opinion questions for a general US audience for the round dated D. People argue about them at dinner; no fact settles them; a person would want to know which way the room went.
- Slots 1 to 4 take one each of `markets`, `sports`, `weather`, `culture`, `news`, read loosely: markets is money and work, sports is sports and games, weather is the outdoors and the seasons, culture is food, film, music and manners, news is society and public life. Slot 5, the Big One, is the one everyone will have an opinion on, in any category.
- Plain words, at most 120 characters, ends in a question mark, no exclamation marks, no leading "Do you think." No question about a death, a tragedy, a private individual, a named person's health, or anything derogatory. No question that asks the player to hope for harm. Politics is allowed as a subject, never as a side.
- No question asked in the last 60 days. The prompt carries the texts of the last 60 days' questions from `questions` where `market_source = 'crowd'`.

Output schema: five entries of `{ slot, category, text }`.

### 4.2 The draft

`toOpinionDraft` builds a `Draft`:

```
slot, category, text                from the call
resolution_criteria                 "YES if more than half of the players who sealed this question answered YES when the round locked. A tie is void."
source_name                         "THE PLAYERS"
source_url                          SITE_URL + "/play"   (new Worker var; default https://outseen-site.etaheri.workers.dev, the URL standings.ts already hard-codes)
author_probability                  0.5
is_big_one                          slot === 5
market_prob                         null
resolves_at                         "after-lock"
market                              { source: "crowd", id: D, event_key: String(slot), closes_at: noonET(D+1) }
```

`DraftQuestionSchema.market.source` gains `"crowd"`. `upsertDraft` skips the two-hour and thirty-hour window checks when the source is `crowd`, stores `marketClosesAt` as the lock, and `resolveBy` as the lock plus six hours. Everything else in `upsertDraft` runs as it does for a market round, including the common-lock check.

### 4.3 Taste

The taste gate runs on the five texts exactly as it does for a market round. A refusal re-authors once with the refused texts named; a second refusal falls through to the bank, as today.

### 4.4 Narration

`2026-09-23: opinion round authored · 5 questions · categories markets, sports, weather, culture, news` or the refusal line. The candidate counts on the round row are zero.

## 5. The Council

`council/member.ts` gains a prompt variant chosen per round by whether every question carries `market_source = 'crowd'`.

System prompt, crowd variant:

- You are one voice of THE ORACLE's Council. The round dated D opens at noon ET and locks at noon ET the following day. It is now <instant>.
- Each question is an opinion. Players answer YES or NO from their own view. Estimate the share of players who will answer YES, between 0.05 and 0.95. Exactly 0.5 is valid when you expect an even room.
- The players are a general US audience on their phones at lunchtime. Weigh what people say when asked directly, not what they believe privately.
- Your reasoning is two to five plain sentences on why the room will lean the way you say. It will be shown to players as written.
- Where lessons from your own earlier calls are given, weigh them; they are yours.

The question block carries the slot, the Big One mark, the text, and the lessons. No `RESOLVES BY`, no market price, no evidence. The output schema is unchanged: `{ slot, p_yes, reasoning, cited }`, with `cited` always empty.

`council/index.ts` skips the evidence step when the round is a crowd round. `commit.ts` is unchanged: with `market_prob` null it writes no market row, and `commitLine` writes the unclamped median. Lessons run at settlement as now; the series key falls back to the category, so a member learns "the room is warmer on food than I expect" across food questions.

The Telegram narration reads `council 2026-09-23: 15 lines committed` with per-slot members and the median, and no Exa line.

## 6. Publish, lock, resolution, settlement

Publish and lock are unchanged.

### 6.1 Resolution

`resolveOne` gains a third branch:

```
q.marketSource === "crowd"  → resolveFromCrowd
q.marketSource truthy       → resolveFromExchange   (as today)
else                        → resolveWithClaude     (as today)
```

`resolveFromCrowd(deps, questionId)`:

1. Re-read the question; return false unless `status === 'locked'` and `now >= locks_at`.
2. Count predictions on the question by answer. `n = yes + no`.
3. `n < CROWD_RESOLVE_MIN` → void, evidence `{ reason: "Too few players answered." }`.
4. `yes * 2 === n` → void, evidence `{ reason: "The room split exactly in half." }`.
5. Else outcome `yes * 2 > n ? "yes" : "no"`, evidence:

```json
{ "quotes": [{ "quote": "62% of 41 players said YES.", "url": "<site>/play" }],
  "crowd_yes_pct": 62, "crowd_count": 41, "checked_at": "<instant>", "resolver": "crowd" }
```

6. Call `resolveQuestion` with the outcome and evidence, as the exchange branch does. `resolveQuestion` already stamps `crowd_yes_pct` and `crowd_count` on the row and pays fortune per prediction.
7. Stamp `resolve_pushed_at = now` on every prediction row of the question in the same pass, so `claimResolutionPushes` finds nothing (T7).

The `[ WHY THIS RESOLVED ]` disclosure on the reveal renders the quote through `evidenceSummary` unchanged; the link opens the site's play page. A void carries its reason as today.

`CROWD_RESOLVE_MIN` lives in `apps/api/src/pipeline/resolve.ts` beside the other pipeline constants, with the comment that it rises to 20 once the field exists.

### 6.2 Settlement

Unchanged. All five resolve on one tick, so `settle` fires on the next, within ten minutes of lock. The hinge push composes as today; its `results` requirement is met by any scored call.

### 6.3 Timing

| ET | Step |
| --- | --- |
| 17:00 D−1 | author: one voice call, one taste call |
| 09:00 D | Council: three member calls, no evidence |
| 12:00 D | publish |
| 12:00 D+1 | lock; resolve all five on the same tick; settle on the next; one hinge push |

Model calls per night: 2 + 3 + up to 15 lessons. No Exa.

## 7. Standings

`loadSettledCalls` selects settled version 3 questions with a line and a yes-or-no outcome; crowd questions qualify. The market row has no calls on them and shows as it does for any member without calls. The crowd row's `p` is `crowd_yes_pct / 100`, which on a crowd question is the outcome's own share; its Brier reads as near-perfect by construction. The standings page footnote gains one sentence: on opinion rounds the crowd is the answer, so its row is the baseline the machines are measured against. The CSV is unchanged in shape.

## 8. API

| Route | Change |
| --- | --- |
| `GET /v1/round/today` | Unchanged in shape. `line_p_yes` is still served; build 12 decides when to show it. A player reading the payload could see the estimate before sealing; accepted for the week, since the tray needs the line to price the double and withholding it server-side is a larger change. `source_name` reads `THE PLAYERS`. |
| `POST /v1/predictions` | Unchanged. |
| `GET /v1/round/:date/reveal` | Unchanged. `market_prob` is null, `evidence_quote` is the crowd line. |
| `GET /v1/standings` | Unchanged in shape. |
| `POST /admin/rounds/:date` | Unchanged; accepts a crowd draft for manual seeding. |
| `POST /admin/rounds/:date/author` | Dispatches on `PIPELINE_ROUND_KIND`, or on a `?kind=` query for a one-off. |

No schema migration.

## 9. Mobile, build 12

Six strings and one conditional. Nothing structural.

### 9.1 Before the seal

`OracleCard` renders no line label and no money preview while the card is unsealed. The side buttons read `YES` and `NO` with accessibility labels `Yes. Seals your call.` and `No. Seals your call.` The hint line stays. `lineLabel` and `sidePreview` are computed but not rendered until `sealed`.

### 9.2 After the seal and on the round screen

- `receiptLine`: `YES · THE ORACLE EXPECTED 38% YES` on the receipt under the stage, with `· DOUBLED` when it carries the double. The stake and winnings move to the tray, where the double decision needs them: `STAKE 50 → 100 · WINS 93 → 186` is unchanged there.
- The crowd verdict line is unchanged: `41% SAY YES · THE PLAYERS SPLIT`.
- `crowdCallLine` on the finale: `YES · THE ORACLE EXPECTED 38% YES · DOUBLED`.

### 9.3 The reveal

- `revealFortune.ts:74-75`: `YOU WERE WITH THE ROOM · +31` and `YOU WERE AGAINST THE ROOM · −50`. A void keeps `STAKE RETURNED`.
- `revealFortune.ts:81`: `THE ORACLE EXPECTED 38% YES · THE ROOM SAID 62%`.
- `council.ts:41`: `THE ORACLE EXPECTED 38`. Member rows are unchanged: `SONNET 35`, `OPUS 44`, `HAIKU 31`, coloured by whether the member's side matched the majority.
- The headline stays the fortune delta (Hand H9).

### 9.4 Rules and intro

`INTRO_LINES`:

1. Five hot takes a day. The Oracle has already guessed what the room will say.
2. Swipe right for YES, left for NO. Nothing about the room shows until you seal.
3. You win when you land with the majority. After your fifth seal, place your double on the call you are surest of.

`RITES_V2_SECTIONS`, "The game": the seven claims rewritten in the same shape for opinions and the room; "Results and the board": "Questions settle on the players' majority at lock" replaces the market sentence; the rest unchanged. `gameCopy.opponentChallenge` becomes `Can you read the room better?` The vocabulary and reading-register lints run as they do.

### 9.5 Practice

`PracticeCard` teaching line: "A hot take from a past round. You play it on a practice fortune of 1,000; nothing here touches your record." The result reads "The room said YES, 62%." in place of "Actual outcome: YES." `TRY THE OTHER SIDE` is unchanged.

### 9.6 Site and store

Site landing lede and the store subtitle: "Three AIs try to predict what you think. Five hot takes a day." No build.

## 10. Copy for the machine voice

New or changed lines, all linted:

- Card receipt: `YES · THE ORACLE EXPECTED 38% YES`
- Reveal: `YOU WERE WITH THE ROOM`, `YOU WERE AGAINST THE ROOM`, `THE ROOM SAID 62%`, `THE ORACLE EXPECTED 38% YES`
- Practice result: `THE ROOM SAID YES · 62%`
- Void reasons: `TOO FEW PLAYERS ANSWERED`, `THE ROOM SPLIT EXACTLY IN HALF`
- Source stamp: `PER THE PLAYERS`

"Line", "stake", "wins" and "fortune" stay in the vocabulary; only their placement changes.

## 11. Analytics

No new events. `question_answered` keeps `line`; it now records the hidden estimate, which is what the beauty-contest analysis needs.

## 12. Testing

- `opinion-round`: a fake Claude returning five valid questions commits a version 3 draft with five `crowd` markets; four categories enforced; a refused text re-authors once; the 60-day exclusion list is passed in the prompt.
- `draft`: `crowd` source accepted; window checks skipped; `marketClosesAt` equals the lock; `resolveBy` is lock plus six hours; a `crowd` draft at version 2 is refused.
- `resolveFromCrowd`: majority YES, majority NO, exact tie voids, empty voids, floor honoured, idempotent on a resolved row, `resolve_pushed_at` stamped so no resolution push is claimed.
- `decideActions`: crowd questions are never in `modelIds`; resolve dispatches on the first tick after lock.
- `council`: crowd variant prompt snapshot; evidence step skipped; no market row written; unclamped median.
- Mobile: the six strings; the card renders no estimate and no money before the seal and does after; vocabulary and reading-register lints pass; practice result copy.
- API suite as a whole.

## 13. Rollout

1. Find why no round published on September 15, 16 or 17. Until it is found, seed each day's round through `POST /admin/rounds/:date` and `/publish`.
2. Deploy the API with `PIPELINE_ROUND_KIND=opinion`. Run `POST /admin/rounds/2026-09-23/author?kind=opinion`, read the Telegram draft, `/reroll` anything flat, then `/council` and `/publish` at noon.
3. Build 12 to TestFlight and App Review the same day. Build 11 remains the fallback: it renders an opinion round with the bookmaker words.
4. First live opinion round at noon September 23. First reveal at noon September 24.
5. September 25 to 27: five people, three rounds each. Ask which question they wanted the answer to.
6. September 28: Devpost, video, screenshots, judge codes.

## 14. Out of scope

The 7 PM lock, the crowd floor of 20, the Oracle's remark on the reveal, removal of fortune, rate-based boards, calendar-sourced forecast questions, machine cards, the inspector reskin. All recorded in the audit and the one-pager for October.

## 15. As built (September 22)

- The "Timing and fairness" rite's market sentence was replaced with "Results land at the next noon, when the round locks." §9.4 said the rest was unchanged; that sentence would have been false.
- `/reroll` on a crowd slot goes through the voice model with the opinion rules (`rerollOpinionSlot`), not the author, since §13 step 2 asks for it and the author prompt researches a source.
- Practice (T10) needed one change after all: `selectExhibition` required a context block, which an opinion never has. A crowd question is offered without one, and carries the room's share for the result line.
- `CROWD_RESOLVE_MIN`, `PIPELINE_ROUND_KIND`, `SITE_URL` and the two void lines are where §4.2, §6.1 and §10 put them.
- The intro's reading-register lint no longer requires the word "stake" in `INTRO_LINES`; it requires "seal" and "room" instead. The spec's intro lines are verbatim and do not say stake; the rules' fourth claim still does.
- The standings footnote says "the players" where §7 says "the crowd", because `crowd` is a retired word on every player-facing surface.
- §13 step 2's "`/council`" is the admin route `POST /admin/rounds/<date>/council`; `/forecast` remains the version 2 single-model stamp and is not part of this rollout.
