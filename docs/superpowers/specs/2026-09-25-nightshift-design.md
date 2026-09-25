# The night shift: three machines, one channel, and the room

Design, September 25, 2026. Amends the hot takes design (`2026-09-22-hot-takes-design.md`) and, where named, the Council design (`2026-09-11-the-council-design.md`) and the Hand design (`2026-09-14-the-hand-design.md`). Written against `main` at `facde12` after the game systems audit (`docs/gameplay/game-design-audit-2026-09-18.md`). The Shipaton deadline is no longer the constraint; this is the game as it should be. Where this document and an earlier one differ, this one is current. Everything not named here is unchanged.

## 1. What this changes and why

The hot takes design converted the mechanics: five opinion questions a day, the room's majority as the outcome, three models predicting the room. Three things are still wrong with it.

The takes are questions, and a hot take is not a question. "Is a hot dog a sandwich?" is a survey item. "A hot dog is a sandwich" is a post. The swipe means agree or disagree, and the majority resolution needs nothing more than that.

The takes come from nowhere. One Sonnet call with no retrieval and a "general US audience at dinner" brief writes plausible, generic questions nobody is arguing about today. Culture happens online; the takes should come from there and read like they do.

The machines are three names on a reveal row. Sonnet, Opus and Haiku each write a reasoning paragraph nobody opens, in the same register, with nothing at stake for them. The game's story, that three models clock in every night and try to guess what people think, is told nowhere in the app.

The change: the machines get a channel. `#nightshift` is a log on the Oracle's terminal where the three post their guesses at 09:00, argue in their own registers, get answered by the room at noon, and react when the room proves them wrong. The player reads the log after the seal, never before. The card keeps its serif and its frame; the log is where the terminal lives. The personas are real model names with job titles, and every claim the persona makes is one the standings can prove.

## 2. The game in one paragraph

Every day at noon ET five hot takes go up, each a statement someone online is arguing about today. Swipe right to agree, left to disagree; the swipe is the seal, and nothing about the room or the machines shows before it. After the seal the channel opens on that take: what each of the three machines guessed at 09:00, and why, in their own words. At the next noon the round locks and each take resolves on the majority of the players who answered it. The room's verdict prints into the channel as a system line, and every machine that got it wrong replies. The reveal is the channel, then the money. The record shows how often you read the room when the machines didn't, and the standings rank the three machines and the players by the same number.

## 3. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| N1 | Takes are statements. The swipe means AGREE (stored as `answer = true`, outcome `yes`) or DISAGREE (`false`, `no`). Rules stay at version 3. | A binary is the game design; the question form was the bug. The API's yes and no are storage words; the player never sees them on a crowd round. |
| N2 | The voice call gets web search and a brief to pull today's live arguments. Each take carries where it was seen. | Cultural relevance is a sourcing property, not a prompt adjective. The client and the usage meter already support the tool. |
| N3 | The register on the card is chronically online, deadpan. One slot a night is genuinely unhinged. The taste gate is unchanged and still fail-closed. | The card is the artifact; its type stays serif. The register lives in the words, not the chrome. |
| N4 | The three members keep their real names and gain job titles and dispositions. Their reasoning is written in their register and shown as written. | A persona the record can prove. Invented characters would make the standings a fiction and the Devpost story a lie. |
| N5 | The channel is readable only for takes the caller has sealed, served by a route that checks the seal server-side. `line_p_yes` leaves `GET /v1/round/today`. | The hot takes design accepted a client-side leak of the estimate for one week. It ends here; the tray reads the line from the log, which exists by the time the tray does. |
| N6 | At resolution each member on the wrong side writes one reaction, in character, through the taste gate. Winners say nothing. | Three short Haiku calls a night at most. Silence from the winner is the joke; a victory lap is not. |
| N7 | The reveal is the channel first, the money second. The headline stays the fortune delta (Hand H9); the channel sits directly under it. | Information first, money second, status third, per the audit's reward order. |
| N8 | Lessons print in the channel as notes to self. No new call. | The machines learning in public is the long-game story and it already exists in the `lessons` table. |
| N9 | The all-time board by best fortune is replaced by a 30-day read-rate board with a minimum of 25 calls. The house line leaves Home. The player joins the standings on the same rate as the machines. | Audit E2, E3 and two "remove before adding" items. A rate a bust cannot improve; a board with a full field of named rivals from day one. |
| N10 | Fortune stays as the felt number. Stakes, the double and the bust are unchanged. | The line is now the Oracle's read of the room, so a win against the line is a win against the machines; the money already scores the right thing. |
| N11 | `CROWD_RESOLVE_MIN` becomes a Worker var, default 20, set low by hand while the field is small. | The floor is an operating fact, not a code change. |

## 4. Authoring

`apps/api/src/pipeline/opinion-round.ts`, amended. `OPINION_PROMPT_VERSION` becomes `opinion-v2`.

### 4.1 Sourcing

The voice call gains `webSearch: true` with the same cap the Council members use. The system prompt states, in this order:

- You write the daily round for OUTSEE, a game where three AIs try to predict what the players think. Find five things people are actually arguing about today, and write each as a hot take: a statement a person would post, that half the room will agree with and half will not.
- Search first. Look at what is being argued on Reddit (r/unpopularopinion, r/AmItheAsshole, r/AskReddit, r/CasualConversation and the subreddit of whatever is in the news), on the day's trending topics, and in the comments under the day's viral posts. Prefer arguments from the last 48 hours. A take may be evergreen if the argument is live today.
- Slots 1 to 4 take one each of four categories from `markets`, `sports`, `weather`, `culture`, `news`, read loosely as now. Slot 5, THE BIG ONE, is the take everyone will have a view on, in any category. Exactly one slot in the five is unhinged: a take that is absurd on its face and that people will still argue about ("Cereal is a soup." "The airport is the best part of the trip."). Mark it.
- Write like a person posting, not like a survey. Lowercase is allowed. No hashtags, no emoji, no exclamation marks. Never open with "Hot take:" or "Unpopular opinion:"; the card already says that.
- The rules on harm are unchanged from the hot takes design: no death, tragedy, private individual, named person's health, anything derogatory, anything that asks the player to hope for harm. Politics is allowed as a subject, never as a side.
- Do not ask anything already posted in the last 60 days.

Output schema, five entries: `{ slot, category, text, unhinged, seen_on: { label, url } | null }`. `text` is 10 to 120 characters, ends in a full stop or nothing, never a question mark. `seen_on.label` is the community as people name it (`r/AmItheAsshole`, `the replies`, `a group chat`) and `url` the thread when search found one; null when the take was written from the day's mood rather than one thread. Exactly one entry has `unhinged: true`.

`TextSchema` drops the question-mark rule and gains: no trailing `?`; no leading `hot take` or `unpopular opinion`, case-insensitive. The four-category rule and the retry loop are unchanged. The taste gate runs on the five texts as now; a refusal re-authors once with the refused texts named.

### 4.2 The draft

`toOpinionDraft` writes `seen_on` and `unhinged` through two new draft fields, `seen_on: { label, url } | null` and `unhinged: boolean`, stored on the question row (§10). `source_name` stays `THE PLAYERS` and `source_url` the site's play page: the players are still the source of the answer; `seen_on` is where the argument came from.

### 4.3 The card's caption

The card's coordinate line (`OracleCard.tsx`, `:: III / PER THE PLAYERS`) becomes `:: III / SEEN ON R/AMITHEASSHOLE` when `seen_on` is set and `:: III / THE NIGHT SHIFT` when it is not. `PER THE PLAYERS` stays the resolution stamp on the reveal. The unhinged take carries a second modifier beside the Big One's, `UNHINGED`, in the same chrome the Big One uses.

### 4.4 Reroll and narration

`/reroll` on a crowd slot goes through the same prompt with search on, for one replacement in the slot's category, and may not produce a second unhinged take. Telegram narration gains the `seen_on` label per slot and marks the unhinged one.

## 5. The night shift

### 5.1 Members

`packages/core/src/council.ts` gains a static table the API, the app, the standings page and the site all read:

| id | name | title | disposition |
| --- | --- | --- | --- |
| `haiku` | HAIKU | night shift | Posts first. Fast, short, lowercase, no punctuation, certain. Wrong first, often. |
| `sonnet` | SONNET | day shift | Keeps the channel on task. Sentences. Usually closest to the room. |
| `opus` | OPUS | senior forecaster | Overthinks. Paragraphs, self-citation, edits itself mid-post. Loses the easy ones and it shows. |

The table is `MEMBER_PROFILE: Record<ModelMemberId, { name, title, register }>`, where `register` is the disposition paragraph the prompt carries. The market member is unchanged and never appears on a crowd round.

### 5.2 The Council prompt, crowd variant

`council/member.ts`, `crowdSystemPrompt`, gains a member block before the rules:

- You are HAIKU, the night shift on THE ORACLE's Council. <register>. You post in `#nightshift`, the Council's channel, which players read after they seal. Your co-workers are SONNET (day shift) and OPUS (senior forecaster).

The audience line changes: "The players are people who post. They are online more than is good for them, they have opinions about everything, and they answer from the gut. Weigh what people say when asked, not what they believe privately." The reasoning line changes per member: Haiku, "one or two lines, lowercase, no punctuation beyond a full stop, no hedging"; Sonnet, "two to four plain sentences"; Opus, "three to six sentences, and you may refer to your own earlier calls by name." Everything else is as the hot takes design wrote it. `COUNCIL_PROMPT_VERSION` becomes `council-v2`.

`crowdCouncilJsonSchema.reasoning` gains `maxLength` per member: 200 for Haiku, 500 for Sonnet, 800 for Opus. A member whose reasoning fails the cap has that slot dropped and abstains on it, as a bad `p_yes` does today.

### 5.3 Reactions

New, `council/reactions.ts`. `writeReactions(deps, questionId)` runs in `ResolutionWorkflow` as a step named `reactions-<questionId>` between `resolve-<id>` and `lessons-<id>`, under `POLICY.model`, with the same never-fails-the-resolution guard `writeLessons` uses.

1. Re-read the question. Return `{ written: 0 }` unless the round is a crowd round with an outcome of `yes` or `no`.
2. For each model member with a line whose `onRightSide` is `false`: one structured Haiku call. System: "You are <NAME>, <title>, reacting in `#nightshift` to being wrong about what the room would say. <register>. One line, at most 140 characters. You may mock yourself, your co-workers, or your own record. Never a player, never a group of people, never the take's subject. No emoji, no hashtags." User: the take, your line, the room's share, the other members' lines and whether they were right.
3. The batch of reactions runs through `tasteTexts` as one call. A refused reaction is dropped. The gate's failure drops the whole batch; nothing prints.
4. Insert into `reactions` (§10), `onConflictDoNothing`.

Members on the right side write nothing. A member whose `p_yes` is exactly 0.5 is neither side and writes nothing. A void writes nothing. The Telegram day report gains a line per reaction.

### 5.4 Lessons

Unchanged in how they are written. The lesson prompt's `NAMES` map is replaced by `MEMBER_PROFILE`, and its system line gains "Write it in your own register" with the member's disposition. Lessons for a crowd question key on the category, as today.

## 6. The channel

### 6.1 The log as data

One shape, built by the API and rendered by the app. `packages/core/src/schemas.ts`:

```
LogLineSchema = {
  at:      ISO instant,
  kind:    "system" | "say" | "note",
  member:  "sonnet" | "opus" | "haiku" | null,   // null on system lines
  text:    string,
  p_yes:   number | null,     // the member's line on a "say" that carries one
  tone:    "win" | "loss" | "mute"
}
```

Lines are ordered by `at`. Build rules, in `packages/core/src/channel.ts`, pure:

- For each member line on the question: a `say` at `committed_at`, text = the reasoning as written, `p_yes` set, tone from `on_right_side` (`mute` before the outcome).
- When the outcome is known: a `system` at `resolved_at`: `THE ROOM AGREED · 62% · 41 PLAYERS` or `THE ROOM DISAGREED · 38% AGREED · 41 PLAYERS`, tone `mute`. On a void: `THE ROOM SPLIT EXACTLY IN HALF` or `TOO FEW PLAYERS ANSWERED`, from `PIPELINE_LINES`.
- For each reaction: a `say` at `created_at`, tone `loss`.
- For each lesson on the question: a `note` at `created_at`, text prefixed `note to self:` by the renderer, not stored.

`buildLog({ lines, outcome, crowd, reactions, lessons })` returns `LogLine[]`. A question with no Council rows returns an empty log; the renderer prints `THE FLOOR WAS DARK` and nothing else.

### 6.2 After the seal

New route, `GET /v1/round/today/log`, device-authed. Returns, for every question in the open round the caller has a prediction on, `{ question_id, line_p_yes, log: LogLine[] }`. Questions the caller has not sealed are absent from the payload, not empty. Before the round locks the log carries `say` lines only; there is no outcome, so tones are `mute`.

`GET /v1/round/today` no longer serves `line_p_yes`. The client's tray prices the double from the log route, which it fetches after each seal (the existing `useMineToday` refetch is the hook). `RoundSchema.line_p_yes` stays optional-nullable for one release so build 12 still parses.

The round screen prints the log for the just-sealed take in the footer slot's place, expanded to fill the space under the stage until the next card is drawn: the three `say` lines print in order with `DecodeLine`, each prefixed by the member's nick in angle brackets and its share. The receipt line under the stage becomes `AGREE · THE ORACLE EXPECTED 38% TO AGREE`. Tapping the stage or drawing the next card collapses it. The finale (after the fifth seal) shows all five logs stacked, collapsed to their `system`-less summary row `<haiku> 31 · <sonnet> 44 · <opus> 40`, each expandable.

### 6.3 The reveal

`GET /v1/round/:date/reveal` gains `reactions: [{ question_id, member, text, created_at }]` and `lessons: [{ question_id, member, text, created_at }]`, and every Council entry carries `committed_at`. The client builds each question's log with `buildLog`.

Under the fortune headline, per question, in slot order:

1. The take in serif, the numeral, the room's gauge (`asciiGauge`) printing to the share, and the with-or-against line: `YOU WERE WITH THE ROOM · +31` (unchanged).
2. The channel: `ChannelLog.tsx`, new. A mono block with a one-line header `#nightshift · <date>` and the log lines. Each line is `HH:MM <nick> text`, timestamp in ET, nick in the member's tone colour, text as written. `system` lines are prefixed `***`. `note` lines are dimmed. Lines print top to bottom through `DecodeLine` on first view, instantly on reduced motion. The block is open by default on the Big One and collapsed to its summary row on the others, remembering nothing between visits.
3. The existing `[ WHY THIS RESOLVED ]` disclosure, unchanged.

`CouncilReading.tsx` and `splitRows` are retired on crowd rounds; the channel replaces both. They stay for version 3 market rounds.

### 6.4 The record

`GET /v1/me/ledger` gains `room: { days_read: n, days_machines_missed: n, read_rate_30d: number | null, calls_30d: n }`, where a day is "read" when the caller was with the room on more calls than against, and "machines missed" when the median line was on the wrong side of the majority on more calls than not, over the same days. `read_rate_30d` is the share of the caller's settled crowd calls in the last 30 days that were with the room, null under 25 calls.

The record screen gains a row under ROUNDS PLAYED and STREAK: `READ THE ROOM · 6 OF 9 DAYS` and, beneath it, `THE MACHINES MISSED · 3 OF 9`. When both are present and `days_read > days_machines_missed`, the line `YOU READ THE ROOM BETTER THAN THE MACHINES` prints in gold; when the reverse, `THE MACHINES READ IT BETTER`; level says nothing.

### 6.5 Home

`GET /v1/round/today` gains `council_committed_at` from the round row. Home's status slot, while a round is open and the caller has not sealed everything, prints `3 MACHINES ONLINE · CLOCKED IN 09:00` under the countdown, from `council_committed_at` in ET; when the round is open but the Council never committed, `THE FLOOR IS DARK · THE MACHINES DID NOT CLOCK IN`. Between rounds the SleepsPanel is unchanged. The house line and `houseLines` leave Home entirely (audit, remove before adding); the `house` block stays on the ledger payload for the reveal's night line.

Last night's result pairs with today's five (audit E4): when the caller played yesterday and yesterday has settled, Home's slot above the countdown prints `LAST NIGHT · +140 · YOU READ THE ROOM ON 4 OF 5`, tapping through to the reveal. The hinge push deep-links to the same reveal. The line is the only place Home mentions yesterday.

### 6.6 The share card

The night card keeps its frame, numeral and wordmark. The middle block becomes a log excerpt for the Big One, mono, ASCII only:

```
#nightshift · 09-25
09:00 <haiku>   31  no chance
09:00 <sonnet>  44
09:00 <opus>    40
12:14 <you>     AGREE
12:00 *** THE ROOM AGREED · 62%
12:01 <haiku>   ok the room is wrong
```

The member's text is truncated to one line with an ellipsis; `<you>` carries the caller's seal time; the reaction line prints only when one exists for a member. The Wordle-grade pattern line and the liturgy footer are unchanged. The share message gains the excerpt's first and last lines.

## 7. Copy

Statements, not questions, everywhere the game names its own content:

- Buttons on a crowd card: `AGREE` and `DISAGREE`, accessibility labels `Agree. Seals your call.` and `Disagree. Seals your call.` A market card keeps `YES` and `NO`. `GET /v1/round/today` gains `crowd: boolean` per question and the client keys every crowd-round string on it; nothing keys on `source_name`.
- Card receipt: `AGREE · THE ORACLE EXPECTED 38% TO AGREE`; with the double, `· DOUBLED`.
- Room verdict after seal: `41% AGREE · THE PLAYERS SPLIT`, `62% AGREE · WITH THE ROOM`, `28% AGREE · AGAINST THE ROOM`.
- Reveal: `THE ROOM AGREED · 62%`, `THE ROOM DISAGREED · 38% AGREED`, `THE ORACLE EXPECTED 38% TO AGREE`.
- Practice result: `The room agreed, 62%.`
- Intro lines: (1) Five hot takes a day. Three machines have already guessed what the room will say. (2) Swipe right to agree, left to disagree. Nothing about the room shows until you seal. (3) You win when you land with the majority. After your fifth seal, read the channel and place your double.
- Rules, "The game": the claims rewritten for agree and disagree; a new claim, "After each seal you can read what the machines guessed and why. They cannot read you."
- Site lede and store subtitle: "Three AIs try to predict what you think. Five hot takes a day. Read the channel."
- Standings page: each row carries the member's title; the footnote gains "The players are people who post."
- `gameCopy.opponentChallenge`: `Can you read the room before they do?`

All linted as today. `AGREE` and `DISAGREE` join `ACRONYMS` in the reading-register lint. The persona text inside the channel is model output and is not linted; it is shown as written, which is the point.

## 8. Standings and boards

### 8.1 The read rate

`packages/core/src/council.ts` gains `readRate(calls: { p: number; outcome: "yes" | "no" }[]): number | null`: the share of calls with `onRightSide === true`, null under `READ_RATE_MIN_CALLS` (25). A player's calls use `p = answer ? 1 : 0`.

`GET /v1/standings` gains a `read_rate` column per row and a `window: 30` field. The HTML page shows name, title, calls, read rate, Brier. Brier is blank on the players' row, as it is now meaningless there. The CSV gains `read_rate`.

### 8.2 The 30-day board

`GET /v1/board/all-time` is retired. `GET /v1/board/room` returns the field of players with at least 25 settled crowd calls in the last 30 days, ranked by read rate, ties by calls; the same top-and-neighbours window and designations the daily board uses; the caller's row and rank; and three pinned rows for the machines from the standings over the same window. `BOARD_MIN_FIELD` applies to human rows only; the machines always show. The money screen's all-time board becomes THE ROOM board with the columns NAME, READ, CALLS. `users.best_fortune` stays written and stays on the record as BEST; it ranks nothing.

### 8.3 The floor

`CROWD_RESOLVE_MIN` reads from the Worker var `CROWD_RESOLVE_MIN`, default 20 in code, and the deployment sets it by hand (3 today). The void reason is unchanged.

## 9. Resolution and settlement

`resolveFromCrowd` is unchanged. `ResolutionWorkflow` gains the reactions step (§5.3). The hinge push is unchanged in shape; its deep link targets the reveal (§6.5). No per-question push on crowd rounds, as the hot takes design ruled.

## 10. Data

Migration 0017:

```
questions  + seen_on_label   text
           + seen_on_url     text
           + unhinged        boolean not null default false

reactions  question_id  uuid  references questions on delete cascade
           member       text
           text         text  not null
           model        text
           prompt_version text
           created_at   timestamptz not null default now()
           primary key (question_id, member)
```

`lines.committed_at`, `lessons.created_at` and `questions.resolved_at` supply the other timestamps; no new columns for them.

## 11. API summary

| Route | Change |
| --- | --- |
| `GET /v1/round/today` | `line_p_yes` removed; `council_committed_at` on the round; `crowd`, `seen_on`, `unhinged` per question. |
| `GET /v1/round/today/log` | New. Logs for the caller's sealed questions only. |
| `GET /v1/round/:date/reveal` | `reactions`, `lessons` arrays; `committed_at` on Council entries; `seen_on`, `unhinged` per question. |
| `GET /v1/me/ledger` | `room` block. |
| `GET /v1/standings` | `read_rate` per row, `title` per member, `window`. |
| `GET /v1/board/room` | New; replaces `/v1/board/all-time`. |
| `GET /v1/exhibition` | A past hot take carries its log so practice ends with the channel. |
| `POST /admin/rounds/:date/author` | Unchanged in shape; runs `opinion-v2`. |

## 12. Mobile summary, build 13

- `OracleCard`: AGREE and DISAGREE on crowd cards; caption from `seen_on`; UNHINGED modifier.
- `round.tsx`: the log under the stage after each seal; finale summary rows; the tray reads the line from the log.
- `ChannelLog.tsx`, new; `game/channel.ts` is the core builder re-exported; `CouncilReading` retired on crowd rounds.
- `reveal/[date].tsx`: gauge, with-or-against line, channel, evidence disclosure, in that order under the headline.
- `ledger.tsx`: the room rows and the verdict line.
- `index.tsx`: machines-online status, last-night line, house line removed.
- `ShareCard.tsx`: the log excerpt.
- Money screen: THE ROOM board.
- Practice: the channel after the result.
- Copy per §7; lints extended.

## 13. Analytics

New events: `log_opened` (after seal, `{ question_id }`), `channel_expanded` (reveal, `{ question_id, member_count, reaction_count }`), `room_board_viewed`. `question_answered` drops `line`: the estimate is no longer on the client at seal time, which is the design. `log_opened` carries `line` instead, so the beauty-contest analysis joins the two events on `question_id`.

## 14. Testing

- `opinion-round`: `opinion-v2` prompt snapshot; search enabled; five statements accepted and a question mark refused; exactly one unhinged; `seen_on` null accepted; reroll cannot add a second unhinged.
- `council/member`: crowd prompt snapshot per member with the disposition; reasoning over the member's cap abstains the slot.
- `council/reactions`: wrong-side members react, right-side and 0.5 do not; taste refusal drops one; taste failure drops all; idempotent; a void writes nothing; runs after resolve and before lessons in the workflow.
- `channel`: `buildLog` ordering, tones before and after outcome, void lines, empty log.
- Routes: `/today` has no `line_p_yes`; `/today/log` serves only sealed questions and 404s with no open round; reveal carries reactions, lessons and `committed_at`; ledger `room` block over fixtures; standings `read_rate`; `/board/room` field, floor, pinned machines.
- Core: `readRate` null under 25; player calls map to 1 and 0.
- Mobile: buttons per round kind; receipt and verdict strings; `ChannelLog` renders lines in order and prefixes notes; reveal order; record rows; Home status lines; share excerpt ASCII-only and one line per member; vocabulary and reading-register lints.
- API suite as a whole.

## 15. Build order

Three plans, in this order; each is shippable alone.

1. **The pipeline.** §4, §5, §10, the reveal and log routes, standings `read_rate`. Deploys with no app change: build 12 renders the new takes as statements with YES and NO buttons, which reads oddly for a day and breaks nothing. The first night's log exists in the database before anything can show it.
2. **Build 13.** §6, §7, §12, §13. Everything the player sees.
3. **The boards.** §8, the ledger `room` block, the money screen's board, the site and standings page copy.

## 16. Out of scope

The 7 PM lock. A weekly shared take. Cross-vendor members and the silent fourth member. Player-authored takes. A channel readable before the seal with the numbers redacted. Fortune's removal. Seasons. All recorded in the audit for later.
