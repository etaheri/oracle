# Hermes Pipeline — Design Spec

**Date:** 2026-08-27
**Status:** Approved decisions baked in (review-window authoring, verify-or-void resolution, Telegram alerts, category skeleton). Companion doc (separate, lighter): the Hermes persona playbook for Twitter/marketing — out of scope here.

## 1. Purpose

ORACLE's game is "who can tell the future." That claim lives or dies on a daily content engine that (a) never misses noon, (b) authors five genuinely contested, objectively resolvable questions, and (c) resolves yesterday with receipts. Today rounds are seeded and resolved by hand via psql. This spec defines **Hermes: the pipeline** — the production half of the Hermes identity. It is deliberately boring infrastructure: a cron-driven state machine inside the existing API Worker that calls the Claude API for the two judgment steps (authoring, resolution) and keeps all control flow in deterministic, tested code.

Non-goals: marketing/Twitter/outreach (persona playbook, separate doc), an approval UI beyond Telegram, multi-round scheduling, forecast-weighting changes.

## 2. The canonical daily rhythm

All times **America/New_York** (ET), computed in-Worker via `Intl.DateTimeFormat` — never UTC offsets (DST).

- Round **D opens at 12:00 ET on day D** and **locks at 12:00 ET on day D+1** (24h window). One round is `open` at a time; the noon tick chains them.
- The in-app copy already promises this: the lock countdown doubles as "THE LEDGER IS READ IN" — **lock, reveal, and settle are all the same noon moment**.
- First-hour bonus = sealed within 60min of `opens_at` (existing behavior, unchanged).

### The noon tick (12:00 ET), in order:
1. **Lock** round D-1: questions `open → locked`, round `open → locked`. (This transition currently doesn't exist anywhere — reveal 409s without it.)
2. **Publish** round D: authored draft flips `scheduled → open`, `opens_at` = noon D, `locks_at` = noon D+1. Publish runs *before* resolution so players are never blocked on resolution latency. Guard: publish is skipped (WARN) while any other round is still `open` — `openRound` assumes exactly one, so a failed lock must never produce two.
3. **Resolve** round D-1: per-question verify-or-void (§6).
4. **Settle** round D-1: once every question is `resolved`/`void`, call the existing `settleRound`. Round `locked → resolved`.
5. **Day report** to Telegram: outcomes, void count, players, tide-winner count — raw material for the marketing Hermes later.

### The evening tick (17:00 ET on D-1):
- **Author** round D as a draft (§5), Telegram the full draft for the review window (§7). Retries until the draft exists, throttled statelessly to once per hour: the AUTHOR action is only eligible on ticks whose ET minute is < 10 (the cron is `*/10`, so exactly one eligible tick per hour). Resolution retries need no throttle — bounded by the 13:00 void deadline and cheap.

## 3. Architecture

**Where it runs:** inside `apps/api` (the existing Hono Worker). Wrangler gains a cron trigger; the Worker gains a `scheduled()` handler. No new deploy target, direct function access to the DB layer and `settleRound`/`resolveQuestion` — no HTTP hop, no second secret store.

**Cron:** `*/10 * * * *` (every 10 minutes, UTC). Cloudflare cron cannot express ET/DST, so the cron is dumb and dense; **all scheduling intelligence lives in code**: each tick computes ET now, reads pipeline state from the DB, and decides which actions are due. Ticks are cheap no-ops when nothing is due.

**State machine, not schedule:** every action derives from *observable DB state + clock*, never from "did the last tick run". This makes every job idempotent and self-healing — a failed author retries on the next eligible tick; a Worker deploy mid-day loses nothing. The decision function is pure and unit-tested:

```
decideActions(now: ETClock, state: PipelineState): Action[]
// state = { openRound?, lockedUnsettledRound?, tomorrowDraft?, unresolvedQuestions[] }
// Actions: LOCK, PUBLISH, RESOLVE(qids), VOID(qids), SETTLE, AUTHOR, ALERT(level, kind)
```

**Module layout** (`apps/api/src/pipeline/`):
- `clock.ts` — ET time helpers (etNow, etDate, isAfterET(h,m), noonOf(date)); pure, tested.
- `state.ts` — `loadPipelineState(db)` + `decideActions` (pure core); the only place timing rules live.
- `author.ts` — authoring prompt, Claude call, draft insert, reroll.
- `resolve.ts` — per-question resolution prompt, evidence shaping, verify-or-void ladder.
- `telegram.ts` — sendMessage + webhook command parsing; all Telegram I/O.
- `claude.ts` — thin Anthropic client wrapper (fetch-based; models + web-search tool config); injectable fake in tests.
- `index.ts` — `runTick(deps)`: load → decide → execute → alert; wired into the Worker's `scheduled()`.

Existing code reused, not duplicated: `resolveQuestion`, `settleRound`, drizzle schema. The existing non-atomicity precondition on `settleRound` (PLAN-4 note in code) is unchanged by this spec; the pipeline's retry-until-settled loop tolerates it the same way the admin route does.

## 4. Database usage (no migration required)

The existing enums already model the lifecycle; the pipeline is their first real driver:
- Round: `scheduled` (draft) → `open` → `locked` → `resolved`.
- Question: `scheduled` → `open` → `locked` → `resolved` | `void`.
- `resolution_evidence` (jsonb) gets, on every resolve/void: `{ outcome, quotes: [{url, quote}], checked_at, model, unverifiable?: true }`.

One new nullable column is **not** needed for v1; reroll history and draft provenance live in Telegram + git. If audit demand grows, a `pipeline_events` table is a later add.

## 5. Authoring (evening, D-1)

**Editorial contract — the category skeleton:**
- Slots 1–4: one question each from four of the five categories `markets | sports | weather | culture | news`; slot 5 (the Big One) is **the day's most contested story from any category** and takes the fifth-category slot when it naturally fits, otherwise duplicates one category (skeleton guarantees ≥4 distinct categories per round).
- Every question must be: binary YES/NO in plain English (house style: "Will the S&P 500 close green today?"); genuinely contested (author's own probability estimate must land in **30–70%**, recorded in the draft message but not stored); resolvable **by 11:00 ET on D+1** from one named public source; culturally legible to a general US audience.
- `resolution_criteria` must name the exact measurement, the exact source page, and the exact deadline ("Official closing level of the S&P 500 for <date> per CNBC markets page"). Ambiguity in criteria is the #1 quality defect — the prompt treats it as such.
- **Forbidden topics:** deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Elections and public-figure *professional* outcomes are fine.
- Question text is player-facing body copy (Serif), not machine voice — normal sentence case, no register constraints from the copy bank.

**Mechanics:** one Claude API call, model `claude-opus-5` (authoring quality is the product; ~1 call/day makes cost irrelevant), with the server-side **web search tool** enabled so questions come from that day's actual news, and a forced tool/structured output returning exactly:

```json
{ "questions": [ { "slot": 1, "category": "markets", "text": "...", "resolution_criteria": "...",
    "source_name": "CNBC", "source_url": "https://...", "author_probability": 0.55, "is_big_one": false } ] }
```

Validation in code (zod): 5 slots, exactly one `is_big_one` (slot 5), categories satisfy the skeleton, probabilities in [0.30, 0.70], all fields non-empty, source_url parses. Validation failure → one automatic retry with the errors appended → then WARN alert and retry next tick.

Insert as round `scheduled` + questions `scheduled` with placeholder `opens_at`/`locks_at` (real noon values stamped at publish). Then send the Telegram draft.

## 6. Resolution (noon tick, D-1's questions) — verify-or-void

Per locked question, one Claude call, model `claude-sonnet-5`, web search **restricted via `allowed_domains` to the question's named source domain** — resolution happens against the source the players were promised, nothing else. Structured output:

```json
{ "outcome": "yes" | "no" | "unverifiable", "quotes": [ { "url": "...", "quote": "..." } ], "reasoning": "..." }
```

- `yes`/`no` with ≥1 quote → `resolveQuestion(db, id, outcome, evidence)`.
- `unverifiable` (or an API failure) → retry on subsequent ticks.
- **Void deadline 13:00 ET:** any question still unresolved at the first tick ≥13:00 is voided (`resolveQuestion(..., "void", { unverifiable: true, ... })`) — void already scores 0 and the complete-rounds rule already handles it. WARN alert names each voided question so Erik can post-mortem the criteria.
- Settle runs on the first tick where no question remains unresolved; a settle that throws retries next tick and CRITICALs if still unsettled at 13:30 ET.

A resolution the model gets *wrong* (source misread) is corrected manually via the existing admin resolve endpoint + re-settle is **not** supported by current `settleRound` idempotency (it early-returns on `resolved`) — wrong-outcome repair is a manual DB operation and an accepted v1 limitation, flagged in the day report format ("reply if any outcome looks wrong").

## 7. The review window (17:00 → noon publish)

Telegram bot (token + Erik's chat id in secrets). The draft message shows all five questions with criteria, sources, and the author's probability estimates. Commands, via a Telegram webhook route on the Worker (`POST /v1/telegram/:webhookSecret`):

- `/reroll <slot> [guidance]` — Hermes re-authors that one slot (fresh Claude call carrying the guidance and the other four questions for dedup), updates the draft row, re-sends the draft.
- `/status` — current pipeline state (tomorrow's draft y/n, today's round, yesterday settled y/n).
- Anything else → replies with the command list.

**No approval is required**: at noon the standing draft publishes regardless (the review window's whole point — Erik can shape it, but his silence never stalls the game). Deeper edits than reroll go through new thin admin endpoints (§8) via curl.

Webhook hardening: the path segment is a random secret; messages from any chat id other than Erik's are ignored.

## 8. Admin endpoints (manual override surface)

Added to the existing `x-admin-secret`-gated router, thin wrappers over pipeline functions:
- `POST /rounds/:date` — create/replace a draft round from a JSON body (manual authoring fallback when the API is down; body = the §5 schema).
- `POST /rounds/:date/publish` — force-publish now.
- `PATCH /questions/:id` — edit `text` / `resolution_criteria` / `source_name` / `source_url` on a `scheduled` question.
- `GET /rounds/:date` — round + questions + statuses (pipeline state probe).
Existing `resolve` and `settle` routes unchanged.

## 9. Alerting (Telegram, three levels)

- **INFO** — draft posted (17:00); day report after settle.
- **WARN** — author validation retry; question voided as unverifiable; any job that failed a tick but has retries left.
- **CRITICAL** — 23:00 ET and no draft for tomorrow; 12:10 ET and no round published; 13:30 ET and yesterday unsettled; Telegram send itself failing is logged (visible in `wrangler tail`/Workers logs) since the alert channel is down.

Every CRITICAL message states the exact manual remedy (`curl` command with the admin route to run).

## 10. Config & secrets

Worker secrets (`.dev.vars` locally, `wrangler secret` in prod): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`; existing `ADMIN_SECRET`, `DATABASE_URL` unchanged. Vars: `PIPELINE_AUTHOR_MODEL` (default `claude-opus-5`), `PIPELINE_RESOLVE_MODEL` (default `claude-sonnet-5`), `PIPELINE_ENABLED` (`"true"` gate so dev/preview deploys don't author rounds — the scheduled handler no-ops without it).

## 11. Failure modes

| Failure | Behavior |
|---|---|
| Anthropic API down in the evening | Author retries hourly; 23:00 CRITICAL with manual-seed curl |
| Anthropic API down at noon | Publish is unaffected (draft exists); resolution retries; void ladder still guarantees settle by ~13:00 |
| No draft exists at noon | CRITICAL; the previous round still locks and settles; home shows THE ORACLE SLEEPS (already a designed state) until manual seed |
| Telegram down | Pipeline proceeds (alerts are advisory, never load-bearing); errors in Workers logs |
| Double tick / concurrent ticks | All actions are DB-state-guarded and idempotent; worst case duplicate Claude call cost |
| Worker deploy mid-day | Stateless — next tick reconstructs everything from DB |

## 12. Testing strategy

- `clock.ts`, `decideActions` — pure unit tests across the whole day grid (evening author due/not-due, noon sequence ordering, void deadline, watchdog thresholds, DST boundary dates).
- Author/resolve — PGlite DB tests with a **fake Claude client** returning canned structured outputs (valid, invalid-then-valid, unverifiable) and a fake Telegram client capturing messages; assert DB transitions and alert contents. No live API calls in tests.
- Telegram webhook — command parsing units + wrong-chat-id rejection.
- Admin endpoints — PGlite route tests in the existing style (secret gate, status codes).
- Zod validation of the authoring schema — exhaustive rejection cases (6 questions, two big ones, probability 0.2, missing criteria).
- Live smoke (manual, once): `PIPELINE_ENABLED` on dev Worker against the dev DB, forced tick via a dev-only admin `POST /pipeline/tick`.

## 13. Build order (maps to the plan)

1. Clock + state machine + `runTick` skeleton with fakes (the spine, fully tested).
2. Lock/publish/settle actions + admin endpoints (pipeline can run a day end-to-end with hand-authored drafts — immediate value, replaces psql ops).
3. Claude client + authoring + validation + Telegram draft.
4. Resolution + verify-or-void + day report.
5. Telegram webhook commands (`/reroll`, `/status`).
6. Cron wiring, `PIPELINE_ENABLED`, dev smoke, prod secrets checklist.
