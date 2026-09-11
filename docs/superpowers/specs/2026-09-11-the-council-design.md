# The Council: a plural line, shared evidence, memory and the open record

Design, September 11, 2026. Third and last plan of the House (`2026-09-10-the-house-design.md`, §5.4b, §13, §14, and the standings row of §7). Written against the code as it stands after Plan 1 (foundation) and Plan 2 (mobile), both merged. Where this document and the House spec differ, this one is current.

## 1. What this delivers

Three things, in the order they are built:

1. **The open record.** A public standings route and page, and a CSV of every settled version 3 question with every member's line. This is the proof that the man-versus-machine claim is true and the artefact for forecasting-research partners.
2. **The Council.** The version 3 line commit becomes three model members reasoning independently over one shared evidence pack per question, with a market baseline, a median, abstention, and per-member lessons fed back under a strict as-of rule.
3. **The reading.** On the reveal, the Council split under each card's line, and each member's paragraph with the evidence it cited.

The bank resolver's date-anchoring fix rides along, since bank questions are the only ones still resolved by a model.

## 2. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| C1 | The Council commit is a third Cloudflare Workflow, `oracle-council`, with one step per model member. Version 2 rounds keep the inline single-model forecast with web search, untouched. | A timeout in one member cannot lose the others (House §13.2). Bank rounds publish at version 2 and are not market-backed, so the Council does not apply to them. |
| C2 | Only the model members vote in the median. The market member is scored and shown but does not vote. | The clamp to the market band already pulls the line toward the market; a market vote would count it twice and blunt the Oracle's disagreement. |
| C3 | The standings page is served by the API, not the site. | The site is static assets with no worker and no scripts, and the API has no CORS. One host, no JavaScript, renders for crawlers and shared links. |
| C4 | Brier and house delta per member are computed at read time, never stored on `lines`. | `lines` rows are immutable; a stored score would need a second write at settlement. |
| C5 | A member's house delta substitutes the member's line **clamped to the same market band** the house uses. | "What the purse would have done had that member been the house alone" means the house's own clamp applies. It also keeps a wild line from producing a hundred-to-one payout in the standings. |
| C6 | Evidence is retrieved inside the Council workflow, minutes before the members commit, not at authoring the evening before. | The published-date ceiling is the retrieval instant; retrieving at commit makes it as late as possible. |
| C7 | Plan 3 includes the split and the reading on the reveal. The Council-sits pre-noon home state stays out. | Chosen against the calendar on September 11. The reading tasks are last in the plan so they can be cut at a task boundary. |
| C8 | Cited evidence ranks that do not exist in the pack are dropped, not treated as a parse failure. | A member that reasons well and mistypes one number should not abstain. |
| C9 | Players see the members as Sonnet, Opus, Haiku and the market. The block is "the Oracle's reading". | Honest names; nothing to explain. None is on the retired list, and nothing else on the surface changes. |

## 3. Members

A static table in code, `apps/api/src/pipeline/council/members.ts`:

| Member | Kind | Model | Prompt version |
| --- | --- | --- | --- |
| `sonnet` | model | `claude-sonnet-5` (`PIPELINE_COUNCIL_SONNET_MODEL`) | `council-v1` |
| `opus` | model | `claude-opus-5` (`PIPELINE_COUNCIL_OPUS_MODEL`) | `council-v1` |
| `haiku` | model | `claude-haiku-4-5-20251001` (`PIPELINE_COUNCIL_HAIKU_MODEL`) | `council-v1` |
| `market` | baseline | none | none |

The fixed display order everywhere is sonnet, opus, haiku, market. Adding a member is one row.

## 4. The nightly Council

### 4.1 Trigger

The pipeline's existing forecast decision (9 to 12 ET, a scheduled round, Claude available, first ten minutes of the hour) branches on the round's rules version:

- version 3: start the `oracle-council` workflow with id `council-${date}-${hourBucket}`, the same idempotency as authoring;
- version 2: run `stampOracleForecast` inline and `commitLine`, exactly as today.

`POST /admin/rounds/:date/council` starts the workflow by hand with a `manual` id. The forecast admin route is unchanged for version 2.

### 4.2 Steps

| Step | Policy | Does |
| --- | --- | --- |
| `editable` | db | Loads the round; returns early if `oracle_committed_at` is set or the round is not `scheduled` at version 3. |
| `evidence` | sourceFetch | One Exa search per question (§5). Skips a question that already has a pack. A failed search leaves the pack empty and records the failure in the step's summary. |
| `member-sonnet`, `member-opus`, `member-haiku` | modelWide | One structured call over all five questions (§6). Returns per-slot results or an abstention. Each step catches its own errors except `BudgetExhausted`, which fails the instance as it does elsewhere. |
| `commit` | db | Median, clamp, one transaction (§7). |
| `narrate` | narrate | One Telegram message: per question, each member's line, the median, the house line, the pack size; any abstentions; the Exa cost. |

The three member steps are sequential in the workflow, as the resolution steps are. Parallel steps are not needed at three calls a night.

### 4.3 Budget

Per night: five Exa searches, three member calls, and at settlement up to fifteen lesson calls (three members, five questions). The daily model-call budget comment gains `council 3, lessons 15` and the cap moves if the count no longer fits. The Exa cost is read from each response's `costDollars` and reported in the narration; the plan's fixture task records the observed figure.

## 5. Evidence packs

For each question, one request to Exa's search endpoint through `deps.exaFetch ?? fetch` with the `EXA_API_KEY` secret:

```
query               = exchange title + "\n" + resolution rules (first 500 characters)
numResults          = 8
startPublishedDate  = retrieval instant − 14 days
endPublishedDate    = retrieval instant
includeDomains      = the resolution source's host when the rules name one, else omitted
contents.highlights = { numSentences: 3, highlightsPerUrl: 1 }
```

Each result is stored in `evidence` as `(question_id, rank, url, title, source, published_at, highlight, retrieved_at)`, rank in result order from 1. `source` is the URL's host. A result without a highlight stores its title as the highlight. A result without a published date is stored with a null date; the ceiling is Exa's filter, not ours, so nothing dated after retrieval can arrive.

A question whose pack is empty still commits; the members' prompt says so. Retrieval is idempotent on `(question_id)`: a question with any evidence rows is skipped.

The resolution source hosts are the hostnames of any URLs written in the exchange's rules text, minus the exchange's own host (`sourceUrl`). A rules text that names no URL leaves `includeDomains` unset.

## 6. The member call

Each model member receives one system prompt and one user message covering the five questions, and returns structured output through the existing tool-use client with **no web search**.

**System prompt** states: the member is one voice of the Oracle's Council preparing the round dated D, which opens at noon ET and locks the following noon; the current instant; forecast, do not resolve; use only the evidence given, numbered per question, and cite by number; 0.5 is valid; report a calibrated probability between 0.05 and 0.95; the reasoning is the route from the evidence to the number in two to five plain sentences, not a transcript; call the tool exactly once with one entry per slot.

**User message**, per question: slot and the Big One mark, the question text, the resolution rules, the market's price at selection, the evidence items as `[n] title — source, date: highlight`, or "No evidence was retrieved for this question." Then, when any exist, the member's lessons under "What you learned before": first the same-series lessons, then the others, each as `(series, date settled) text`.

**Output schema**, `council_lines`: `{ lines: [{ slot 1..5, p_yes 0.05..0.95, reasoning string, cited int[] }] }`, five entries, unique slots.

**Abstention.** A step that throws, times out, or whose output fails the schema abstains on all five slots. An entry with an out-of-range `p_yes` abstains on that slot alone. Cited ranks not present in the pack are dropped (C8). An abstention is recorded in the step summary and narrated; it writes nothing.

### 6.1 Lessons received (the as-of rule)

Before the call, the member's lessons are selected: at most five with the question's `series_key`, then at most three from any other series, most recent first by `resolved_at`, **only where `resolved_at` is strictly before the commit instant**, and only the member's own. `series_key` is `questions.market_series_key`, falling back to the question's category. The ids received are written to `lines.lessons_received` at commit so the reading can say what the member remembered.

## 7. Commit

For each question, the median of the model members present (C2): one present is that value; two is their mean; three is the middle. If any question has fewer than two model members present, no line is committed for the round, the round opens unstaked as an uncommitted round does today, and the narration carries a `‼️` alert.

Otherwise, one transaction:

1. `commit_oracle_forecast(date, snapshot, model, prompt_version, completed_at)` with the medians as `pYes`, `model = "council"`, `prompt_version = "council-v1"`. The existing function writes `questions.oracle_p_yes`, the round's committed columns, and enforces the snapshot and the deadline as it does today.
2. Insert one `lines` row per question and present member, including `market` at `questions.market_prob` with null model, prompt version and reasoning. `committed_at` is the step's instant; `cited` and `lessons_received` as computed.
3. `commitLine(db, date)`: the existing clamp of `oracle_p_yes` to the market band, written once to `questions.line_p_yes`.

The commitment guard triggers on `questions` and `rounds` are untouched; `lines` and `evidence` are new tables outside their reach. A re-run finds `oracle_committed_at` set at `editable` and does nothing.

## 8. Lessons

The resolution workflow gains, after each `resolve-${questionId}` step that settled a version 3 question with an outcome of yes or no, a `lessons-${questionId}` step on the `model` policy. For each model member with a `lines` row on that question and no lesson yet, one Haiku call (`PIPELINE_LESSON_MODEL`, default Haiku 4.5, prompt version `lesson-v1`) receives the question, the rules, the outcome, the member's line and reasoning, and returns `{ text }`: two to four plain sentences saying whether the line was on the right side, what in the reasoning held or failed, and one concrete adjustment for the next question in the same series. Inserted into `lessons` with `series_key`, `question_id`, `resolved_at` from the question, unique on `(member, question_id)` so a retried step writes nothing twice. A void question writes no lessons. A failed lesson call is logged and skipped; it never fails the resolution instance.

Lessons are one member's own. No member's prompt ever carries another's.

## 9. Series key

`MarketCandidate.seriesKey` already exists (Kalshi: the event ticker's series prefix; Polymarket: the first tag). It is plumbed through the draft's `market` block as `series_key`, written by `upsertDraft` to a new `questions.market_series_key`, and used by §6.1 and §8.

## 10. The bank resolver

`ResolverTarget` gains `opensAt` and `now`. The system prompt gains: "It is now {now}. This question opened at {opensAt}. Evidence describing events that concluded before the open instant describes a different event and must not settle this one." `resolveWithClaude` fills both. Nothing else on the model path changes.

## 11. Schema

Migration `0015`, additive:

```
questions.market_series_key   text

lines        question_id uuid → questions, member text, p_yes numeric not null,
             committed_at timestamptz not null, model text, prompt_version text,
             reasoning text, cited integer[] not null default '{}',
             lessons_received uuid[] not null default '{}'
             primary key (question_id, member)

evidence     question_id uuid → questions, rank integer, url text not null, title text not null,
             source text not null, published_at timestamptz, highlight text not null,
             retrieved_at timestamptz not null
             primary key (question_id, rank)

lessons      id uuid primary key default gen_random_uuid(), member text not null,
             series_key text not null, question_id uuid → questions, text text not null,
             resolved_at timestamptz not null, created_at timestamptz not null default now()
             unique (member, question_id); index (member, series_key, resolved_at)
```

## 12. Core

Pure functions in `packages/core/src/council.ts`, no I/O:

- `MEMBER_ORDER = ["sonnet", "opus", "haiku", "market"]`.
- `medianLine(values: number[]): number | null` — null under two values.
- `sideOf(p: number): "yes" | "no" | null` — null at exactly 0.5.
- `onRightSide(p, outcome): boolean | null` — null on void or at 0.5.
- `memberBrier(p, outcome): number | null`.
- `memberHouseDelta(line, marketProb, predictions: {answer, stake, outcome}[]): number` — clamps the line as the house does (C5), then sums stake minus payout over the predictions with the existing `payout`.
- `crowdBrier(crowdYesPct, outcome)`.
- `standingsRow(calls: {...}[])` — aggregates calls, mean Brier, house delta.
- Zod: `CouncilEntrySchema`, `EvidenceItemSchema` added to the reveal with `.default([])`; `StandingsSchema`.

## 13. API

| Route | Auth | Returns |
| --- | --- | --- |
| `GET /v1/round/:date/reveal` | device | Adds, after lock only, `council`: one entry per question and member in `MEMBER_ORDER` with `question_id`, `member`, `p_yes`, `on_right_side`, `reasoning`, `cited`, `lessons_received` (count); and `evidence`: every pack item with `question_id`, `rank`, `url`, `title`, `source`, `published_at`, `highlight`. Both default to empty. |
| `GET /v1/standings` | none | `{ as_of, rounds, questions, rows: [{ member, calls, brier, house_delta }] }` for each member in order plus `crowd` and `market`, over settled version 3 questions with a line and outcome yes or no. Crowd rows use the question's crowd yes-percentage. `Cache-Control: public, max-age=300`. |
| `GET /v1/standings?format=csv` | none | `text/csv`: `date, slot, question, market_source, market_id, market_prob, member, member_line, house_line, crowd_yes_pct, crowd_count, outcome`, one row per settled question and member, ordered by date, slot, member. Nothing about any player. |
| `GET /standings` | none | HTML: title, the table, one line explaining the rule ("Each member commits a line on every question before it opens. Brier is the mean squared error of the line; house delta is what the purse would have done with that member alone, at the stakes players actually placed."), a link to the CSV, the site's colour and type tokens inlined. Same cache header. |
| `POST /admin/rounds/:date/council` | admin | Starts the workflow; returns the instance id. |
| `GET /admin/rounds/:date` | admin | Adds `lines` and `evidence` counts per question. |
| `GET /admin/lessons?member=&series=` | admin | Lists lessons, newest first, up to 100. |
| `DELETE /admin/lessons/:id` | admin | Removes one. |

The public routes live in a new router mounted in `createApp` without `deviceAuth`. There is no CORS; nothing fetches these from a browser on another origin.

## 14. Site

The nav on `index.html`, `play.html`, `privacy.html` and `support.html` gains `Standings`, linking to the API host's `/standings`. No other change.

## 15. Mobile

### 15.1 Pure modules, `apps/mobile/src/game/council.ts`

- `councilFor(d: Reveal, questionId): CouncilEntry[]` in `MEMBER_ORDER`.
- `splitRows(entries, linePYes)`: rows of `{ label, value, tone }` — `SONNET 40`, `OPUS 31`, `HAIKU 44`, `MARKET 35`, then `THE ORACLE'S LINE 35`; tone `win` | `loss` | `mute` from `on_right_side`.
- `readingFor(entry, pack)`: `{ paragraph, cited: EvidenceItem[], alsoRead: EvidenceItem[] }` in rank order.
- `memberName(member)`: `Sonnet`, `Opus`, `Haiku`, `the market`.

### 15.2 The split

The reserved zero-height view under each card's line context on `reveal/[date].tsx` (and the Big One block's line) renders `splitRows` when `councilFor` returns entries: one `Mono` meta row per member, coloured gold, vermilion or muted ink by tone, then the house line row in muted ink. The slot reserves `minHeight` for five rows when entries exist and stays zero otherwise, so version 1 and 2 reveals, unstaked rounds and pending reveals are unchanged.

### 15.3 The reading

Under each model member's row, a `QuietLink` `THE ORACLE'S READING` toggles a `CouncilReading` block: the paragraph in sentence case as written; then `EvidenceCard` for each cited item, using `CardChrome` at small scale with the title, `SOURCE · DATE` in tracked caps, and the highlight in sentence case; then an `ALSO READ` row listing the uncited items by title and source. Cards open their URL with `Linking.openURL`. Opening a reading fires `reading_opened` with the member. Only one reading is open per question at a time.

### 15.4 Copy

The new player-facing words are Sonnet, Opus, Haiku, the market, and the Oracle's reading. None of them is on the retired list, so the vocabulary lints need no change. Evidence titles and highlights come from the server and are exempt from the register test, as resolution evidence quotes already are.

## 16. Testing

- Core: median for one, two, three, four values; side and right-side at 0.5 and on void; member Brier; house delta with the clamp on a wild line and against the real house line on the same predictions (equal when the member is the house); the standings row aggregate; the schemas accept an old reveal without `council`.
- Pipeline: with a stub Claude and a stub Exa using the fixture pattern of `exchanges-fixture-round.test.ts`: a full run writes five packs, fifteen model lines and five market lines, medians in `oracle_p_yes`, the clamped line; a member that throws abstains and the other two commit; one member present opens the round unstaked and alerts; a second run writes nothing; out-of-pack citations are dropped; an empty pack still commits and the prompt says so; the as-of filter excludes a lesson resolved after the commit instant and includes one resolved before; caps of five and three hold; a member never receives another member's lesson; `lessons_received` is written; the market member is never sent to a model; a version 2 round still takes the inline forecast path.
- Lessons: written only for yes or no outcomes, once per member and question across a retried step, never for a member without a line.
- Resolver: the bank prompt carries both instants and the different-event rule; the exchange path is untouched.
- Routes: the reveal carries `council` and `evidence` after lock and neither before; `/v1/standings` aggregates a seeded settled round correctly for every member, the crowd and the market; the CSV has the stated columns and no user fields; `/standings` returns HTML without a device token; the admin lessons list and delete.
- Mobile: the pure modules; the split renders only when entries exist and reserves no height otherwise; the reading opens and closes and lists cited before uncited; the version 2 reveal renders as before; the vocabulary lint passes with the four new words.
- Timing: the API suite stays under the existing note, about six and a half minutes; bare 5,000 ms timeouts are contention.

## 17. Rollout

1. Apply `0015` to `oracle-prod`. Set the `EXA_API_KEY` secret. Add the `oracle-council` workflow binding and the three member model vars to `wrangler.jsonc` and `WorkerEnv`.
2. Deploy the API. Confirm `/standings` renders with zero rows.
3. Run `POST /admin/rounds/:date/council` against the next scheduled version 3 round. Read the Telegram narration: five packs, three members, the median and the line per question.
4. After that round settles, confirm the lessons rows and the standings figures.
5. Add the Standings nav link on the site and deploy it.
6. Ship the mobile build.

## 18. Out of scope

- The Council-sits pre-noon home state (C7).
- Seers, Visitors, debate between members, a moving line (House §15).
- A stored score on `lines` (C4).
- CORS on the API; any client-side fetch of the standings.
- Exposing lessons to players. They are visible to the operator only, and to the reading only as a count.
