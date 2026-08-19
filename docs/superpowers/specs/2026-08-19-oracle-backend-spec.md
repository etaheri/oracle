# ORACLE — Backend Contract Spec

**Date:** 2026-08-19
**Companions:** `2026-08-09-oracle-design.md` (product), `2026-08-19-oracle-tech-spec.md` (stack)
Constants marked ⚙ are tunables living in `packages/core/constants.ts` — the *properties* are the spec; exact values get tuned in TestFlight.

## 1. Data model (Neon Postgres, Drizzle)

```
users
  id uuid pk
  clerk_id text unique null          -- null = anonymous (device-only)
  created_at timestamptz
  streak_current int, streak_best int
  free_shield_used_at date null      -- one free shield per calendar month
  oracle_score int null              -- cached; null until calls_resolved >= 50
  calls_resolved int
  title enum(apprentice|augur|seer|oracle|prophet) generated from percentile job

devices
  id uuid pk, user_id fk
  install_token_hash text            -- HMAC of signed device token
  platform enum(ios|android), onesignal_id text null

rounds
  date date pk                        -- one global day, drop 16:00 UTC
  status enum(scheduled|open|locked|resolved)
  player_count int                    -- cached from DO at lock

questions
  id uuid pk, round_date fk, slot int 1..5, is_big_one bool
  text text, category enum(markets|sports|weather|culture|news)
  resolution_criteria text, source_name text, source_url text
  opens_at/locks_at/resolve_by timestamptz
  status enum(draft|approved|scheduled|open|locked|resolved|void)
  outcome enum(yes|no|void) null, resolved_at, resolution_evidence jsonb
  crowd_yes_pct numeric null          -- cached at lock (final), DO holds live value
  market_prob numeric null            -- Manifold/Kalshi difficulty gauge at selection

predictions
  id uuid pk, question_id fk, user_id fk
  answer bool, confidence int check 55..95 step 5
  created_at timestamptz (server), first_hour bool
  brier numeric null, points int null -- filled at resolution
  unique(question_id, user_id)        -- the anti-cheat constraint

question_drafts                       -- Hermes staging; admin promotes → questions
  id, payload jsonb, agent_run_id, created_at, status enum(pending|approved|rejected)

oracle_forecasts                      -- the machine's own prophecy (§4)
  question_id pk fk, p_yes numeric, method_version int, computed_at
  brier numeric null                  -- graded like everyone else

entitlements                          -- RevenueCat webhook cache (RC is source of truth)
  user_id pk fk, plus_active bool, shields_remaining int, expires_at, updated_at
```

Indexes: `predictions(user_id, created_at)`, `questions(round_date)`, `users(oracle_score desc nulls last)` for leaderboard.

## 2. Lifecycle state machines

**Question:** `draft → approved → scheduled → open (16:00 UTC) → locked (next 16:00 UTC) → resolved(yes|no) | void`
Transitions `open→locked` and `scheduled→open` fire from the round Durable Object alarm (not cron — exact-time). `resolved/void` only via admin confirm or API-attested auto-resolve (bright line per design spec §6). Void ⇒ predictions get `points=0, brier=null` (excluded from Oracle Score), streak credit still granted.

**Round:** mirrors its questions; `resolved` when all 5 terminal. Reveal payload becomes immutable + edge-cached forever at that point.

## 3. Scoring (implemented once, in `packages/core`)

Let `p` = confidence in the player's chosen side (0.55–0.95), `o` = 1 if correct.

- **Brier (truth economy):** `b = (p_yes − outcome)²` where `p_yes` = `p` if answered YES else `1−p`. Range 0..0.9025.
- **Oracle Score:** `1000 × (1 − mean(b) over last ⚙100 resolved, non-void calls)`, shown only when `calls_resolved ≥ ⚙50`. Always-55% coin-flipping ≈ 750; the leaderboard's working range is ~740–950. Tiebreak: crowd-relative mean (player b − crowd b on same questions), which also feeds title percentiles.
- **Daily points (fun economy), per question:**
  - correct: `2 × (p×100 − 50)` → 10..90
  - wrong: `−3 × (p×100 − 50)` → −135..−15 (overconfidence is negative-EV unless you're genuinely right >60% of the time — honesty stays optimal even in the fun economy)
  - **Contrarian bonus:** ×⚙2 if correct and final `crowd_yes_pct` had your side < ⚙40%
  - **Big One:** ×2. **First hour:** +⚙10% on the day's positive total.
- **Streak:** played (≥1 lock) each round date = +1. Missed day: consume free monthly shield → hold; else consume paid shield (entitlements.shields_remaining) → hold; else reset. All server-side at drop time for the prior round.

## 4. The Oracle's forecast (per question, computed at lock)

`p_oracle = extremize(Σ wᵢ·pᵢ_yes / Σ wᵢ)` where `wᵢ = 1` for unrated players and `wᵢ = ⚙exp((oracle_scoreᵢ − 750)/⚙60)` for rated ones; `extremize(p) = p^d / (p^d + (1−p)^d)`, ⚙d = 1.5 (GJP-style). Cold start (< ⚙500 rated players): raw crowd mean, no extremizing. Stored in `oracle_forecasts` with `method_version`, graded on resolution, surfaced in reveal + @ORACLE receipts. Never exposed before the caller has locked (same wall as crowd %).

## 5. API surface (Hono; all bodies zod-validated from `packages/core`)

**Public/app (device token or Clerk JWT):**
```
POST /v1/auth/device            → mint signed anon device token (rate-limited by IP)
POST /v1/auth/merge             → attach device history to Clerk user (idempotent)
GET  /v1/round/today            → edge-cached: questions (no crowd data), opens/locks, player_count snapshot
POST /v1/predictions            → {question_id, answer, confidence, idempotency_key}
                                  409 after locks_at; unique-violation returns prior row (idempotent)
GET  /v1/round/:date/reveal     → my picks + crowd % + oracle forecast + points; requires all-locked or round locked;
                                  immutable + cached once resolved
GET  /v1/round/:date/live       → SSE from round DO: player_count, (post-lock only) drifting crowd %
GET  /v1/me                     → profile, streak, shields, oracle_score, title, history cursor
GET  /v1/leaderboard?scope=global|weekly&cursor=
GET  /v1/share/:roundDate       → payload for Skia card (also used by web OG)
```

**Webhooks:** `POST /v1/webhooks/revenuecat` (entitlement cache upsert, signature-verified) · `POST /v1/webhooks/clerk` (user create/delete).

**Admin (Cloudflare Access-gated, separate route group):**
```
GET/POST /admin/drafts          → list/approve/edit/reject Hermes drafts
POST /admin/questions/:id/resolve  {outcome, evidence}   · POST .../void {reason}
GET  /admin/health              → today's counts, unresolved past-due, agent last-run
```

**Web (Astro, server-side):** `GET /v1/share/:roundDate` reused for `/q/:date` landing + OG image.

## 6. Scheduled jobs (Workers Cron) 

| UTC | Job |
|---|---|
| 13:00 | Hermes draft run (feeds + Manifold/Kalshi) → `question_drafts`; alert if approved buffer < 24h |
| 15:55 | Preflight: verify today's 5 scheduled; page operator if not |
| 16:00 | (DO alarms) lock yesterday, open today; compute oracle_forecasts + final crowd %; snapshot player_count; streak/shield settlement; rebuild edge cache; trigger OneSignal drop push |
| hourly | Resolution poller: fetch attestable sources for locked questions; auto-resolve attestable, queue rest for admin; on full-round resolve → points/brier batch, Oracle Score recompute, results push |
| daily 04:00 | Title percentile recompute; leaderboard cache; @ORACLE receipt payload for the agent |

## 7. Security & abuse

- Server clock is the only clock; `locks_at` enforced in SQL predicate, not app logic.
- One prediction per (user, question) via unique index; idempotency keys make retries safe.
- Device tokens: HMAC-signed, per-install, rate-limited minting (sybil cost). Leaderboard/prizes require Clerk account + ⚙50 resolved calls — sybils can inflate crowd % marginally but can't reach status or (later) prizes cheaply; revisit before cash prizes.
- Workers rate limiting on writes (per token + per IP), CORS locked to app/site origins, webhook signature verification, zod on every boundary.
- PII minimum: email (Clerk-held), display name. No location, no contacts.

## 8. Failure modes

- **Neon down at noon:** round still drops (edge-cached read path); submissions fail visibly with retry — accepted risk, short window.
- **DO lost:** counter resets cosmetic-only; authoritative data is Postgres.
- **Resolution source down:** question stays `locked` past `resolve_by` → admin alert; resolve late or void. Reveal renders partial results honestly ("1 prophecy pending").
- **Agent down:** 24h approved buffer + 15:55 preflight page. Drop never depends on Hermes.
```
