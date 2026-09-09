# ORACLE Launch Playbook

Written Sept 7, 2026. Shipaton deadline **Sept 30, 2026**.

Consolidates and supersedes the account/dashboard half of
`docs/superpowers/plans/assets/revenue-rites/dashboard-runbook.md` (whose §5
is stale — the Sentry org and privacy URL are environment-driven now, not
source placeholders).

---

## 0. Where things actually stand

Verified Sept 7, 2026:

| Thing | State |
|---|---|
| `origin/main` | `e542fa8` — everything local is pushed |
| Tests / typecheck | 959 pass (core 136 / mobile 317 / api 506); typecheck clean |
| Cloudflare Worker `oracle-api` | **Does not exist.** `wrangler deployments list` → "This Worker does not exist on your account" |
| Production Neon DB | None. Only `oracle-dev` via `apps/api/.dev.vars` |
| `oracle-dev` migration state | Behind — at `0006`; `0007` and `0008` unapplied. Any read of `questions`/`rounds` 500s until migrated |
| Pipeline | Never run in production. `PIPELINE_ENABLED` unset everywhere |
| App Store Connect | No app record |
| Auth | `wrangler`, `eas` (etaheri@me.com), `gh` all logged in |

Nothing is deployed. The critical path below is the whole path.

---

## 1. Accounts — blocks everything downstream

Do these first; later steps consume IDs and secrets minted here.

1. **Apple Developer enrollment.** Required before App Store Connect or any
   EAS build with capabilities (Sign in with Apple, push).
2. **RevenueCat — sign up direct at revenuecat.com, NOT via Stripe Projects.**
   The Stripe-Projects path provisions a different account shape than this
   integration expects. Create the iOS app with bundle id `com.erikt.oracle`.
3. **OneSignal via the Shipaton perk link** (free Growth tier — the normal
   signup does not apply the perk). Create the iOS app.
4. **PostHog** project — note the project API key.
5. **Sentry** org + project named `oracle-mobile`.
6. **A domain and a publicly reachable privacy-policy page.** This is a hard
   App Review gate: the Plus paywall links to it, and the App Privacy
   questionnaire needs it. Cheapest honest path is a Cloudflare Pages site on
   a domain you already own.

**Bundle id is `com.erikt.oracle`** everywhere in the repo — `app.json`, the
generated Xcode project (app + OneSignal extension targets), the SIWA audience
default in `apps/api/src/routes/auth.ts`. If you register something different
in the Apple portal, the repo is what changes.

---

## 2. Backend to production

### 2.1 Create the production database

Create a separate Neon project (not a branch of dev) — call it `oracle-prod`.
Keep its connection string out of `.dev.vars`.

### 2.2 Apply migrations

Nine migrations exist, `0000` through `0008`. Drizzle's relational query
builder selects every schema-declared column, so a database behind the schema
does not degrade — every read 500s.

```bash
cd apps/api
DATABASE_URL='<prod connection string>' pnpm db:migrate
```

Then do the same for dev, which is stuck at `0006` and currently broken:

```bash
cd apps/api
export DATABASE_URL=$(grep '^DATABASE_URL=' .dev.vars | cut -d= -f2-)
pnpm db:migrate
```

`0008` is additive: `questions.context jsonb`, `rounds.rules_version integer
NOT NULL DEFAULT 1`. Existing rows stay on version-1 scoring; new automated
drafts write version 2 (`CURRENT_RULES_VERSION` in
`packages/core/src/roundRules.ts`). Historical results are preserved by design.

### 2.3 Set secrets

`WorkerEnv` in `apps/api/src/worker.ts` is the authoritative list; the comment
block at the bottom of `apps/api/wrangler.jsonc` mirrors it. Keep the two in
step.

```bash
cd apps/api
# required — the API will not serve without these
wrangler secret put DATABASE_URL
wrangler secret put DEVICE_TOKEN_SECRET     # HMAC key; also salts the mint-throttle IP hash
wrangler secret put ADMIN_SECRET            # x-admin-secret header on /admin/*

# revenue — without the first, EVERY RevenueCat webhook 401s and
# every purchase silently grants nothing
wrangler secret put REVENUECAT_WEBHOOK_SECRET
wrangler secret put APPLE_BUNDLE_ID         # only if it differs from com.erikt.oracle

# pipeline — the cron stays inert without PIPELINE_ENABLED
wrangler secret put PIPELINE_ENABLED        # "true"
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put TELEGRAM_WEBHOOK_SECRET

# push — absent, the hinge push at settle no-ops. Nothing else changes
wrangler secret put ONESIGNAL_APP_ID
wrangler secret put ONESIGNAL_API_KEY
```

**Question resolution pushes:** Each question now pushes its players the moment it resolves (yes/no). One push per player per question, composed from the `resolve` copy pool. The claim is idempotent — a single `UPDATE predictions SET resolve_pushed_at = now() WHERE resolve_pushed_at IS NULL AND points IS NOT NULL RETURNING` — so the hourly re-dispatch never double-sends. Admin resolves, withdrawals, and voids never trigger push. The settle-time hinge push (published round announcement) is unchanged. `GET /v1/me/ledger` now also returns `reading` — the player's latest locked-or-settled round with decided/total counts — which home uses for the IN PLAY line and the ledger CTA.

Leave `PIPELINE_ENABLED` unset for the first deploy. Arm it deliberately in §3.

### 2.4 Deploy

```bash
cd apps/api && pnpm deploy
```

Then **verify the three Workflow bindings actually registered**
(`AUTHORING_WORKFLOW`, `RESOLUTION_WORKFLOW`, `PROBE_WORKFLOW`). A missing
binding does not fail the deploy — `buildPipelineDeps` logs a warning and
falls back to inline execution, which silently reinstates the exact
15-minute-cron-cap bug the Workflow substrate exists to fix. Check the Worker's
Settings → Bindings in the dashboard, and grep the tail:

```bash
wrangler tail --format pretty | grep -i "no Workflow bindings"
```

Smoke test the deployed URL before pointing anything at it:

```bash
curl -s https://<worker-url>/v1/round/today | head
curl -s -H "x-admin-secret: $ADMIN_SECRET" https://<worker-url>/admin/rounds/$(date +%F)
```

```bash
# Strike a mis-authored question from a live round with an honest reason.
# reason: "misauthored" | "unresolvable". Day still rates on the remaining
# non-void questions if at least three remain.
curl -s -X POST -H "x-admin-secret: $ADMIN_SECRET" -H "content-type: application/json" \
  -d '{"reason":"misauthored"}' https://<worker-url>/admin/questions/<question-id>/withdraw
```

### 2.5 Wire the URL back out

The deployed origin is now an input to three other systems:

- RevenueCat webhook → `https://<worker-url>/v1/webhooks/revenuecat`, with
  header `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`.
- Telegram webhook → the bot's `setWebhook`, with the secret header.
- Mobile → `EXPO_PUBLIC_API_URL` in the EAS environment (§4). Without it the
  app falls back to `http://localhost:8787` and a shipped build talks to
  nothing.

---

## 3. Arm the pipeline — supervise the first day

The pipeline has **never executed a single unattended day**. Everything in it
is covered as code and uncovered as operations. Cost when armed is roughly
**$80–96/month** in model calls; the probe cadence is the largest line, the
second resolver's Opus call the next.

Arm it, then watch one full cycle end to end:

```bash
cd apps/api
wrangler secret put PIPELINE_ENABLED   # "true"
wrangler tail --format pretty
```

The cron fires every 10 minutes. The day's shape:

- **noon ET** — publish, and the Oracle's forecast is stamped in the *same
  tick*, pushed after publish. If the forecast lands at 13:00 instead, the
  ordering regression is back (it used to trail every first-hour player).
- **lock / probe** — a 4-hourly probe pulls a lock forward when an answer
  appears early.
- **settle** — resolution reads twice with two *different* models; a
  disagreement resolves to unverifiable, never a winner. Never set
  `PIPELINE_RESOLVE_MODEL` and `PIPELINE_RESOLVE_MODEL_B` to the same model —
  that silently removes the error independence the second read buys.

`PIPELINE_DAILY_CALL_BUDGET` is 150, which caps an unattended retry storm.
Telegram is the operator console: `/status`, `/reroll <slot> [guidance]`,
`/flip <slot> <yes|no|void>`.

Every threshold in the gauntlet is a first guess. Plan to tune them off the
first live week's rejection tally.

Manual override if you want a round on the board before trusting the cron:
`POST /admin/rounds/:date` (upsert draft) → `POST /admin/rounds/:date/publish`
→ `POST /admin/rounds/:date/settle`, all behind `x-admin-secret`. And
`POST /admin/pipeline/tick` runs one tick on demand.

---

## 4. Mobile release

### 4.1 EAS environment variables

Set per profile (development / preview / production) in the EAS dashboard:

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_API_URL` | the deployed Worker origin — without it the build talks to localhost |
| `EXPO_PUBLIC_RC_IOS_KEY` | RevenueCat iOS public key |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | |
| `EXPO_PUBLIC_POSTHOG_KEY` | `EXPO_PUBLIC_POSTHOG_HOST` defaults to us.i.posthog.com |
| `EXPO_PUBLIC_SENTRY_DSN` | runtime DSN |
| `SENTRY_ORG` (+ optional `SENTRY_PROJECT`) | build-time. Absent → `app.config.js` drops the Sentry plugin entirely rather than shipping a fake org |
| `EXPO_PUBLIC_PRIVACY_URL` | **App Review gate.** Absent → the paywall offers no link at all |
| `EXPO_PUBLIC_SHARE_URL` | `https://apps.apple.com/app/id<ASC id>`. Leave unset until the record exists — absent ships a link-free share, which is correct |

Every native key is optional by design: an absent key means that SDK stays
dark and the app still runs. Absent is safe; wrong is not.

### 4.2 App Store Connect

- App record, bundle id `com.erikt.oracle`.
- Subscription group `oracle_plus`: `plus_monthly` $2.99, `plus_annual` $19.99.
- Consumable: `shield_rescue` $1.99.
- Offer codes for `plus_monthly` — the Shipaton judges need these.
- App Privacy: device ID **collected**, purchases **collected**, diagnostics
  **collected**, tracking **NO** (so no ATT prompt; do not enable
  tracking-linked types).

### 4.3 RevenueCat + OneSignal

- Entitlement `plus` on both subscription products; offering `default` with
  `plus_annual` featured.
- Enable RevenueCat's OneSignal integration in **external-id mode**.
- OneSignal lifecycle campaign (a Shipaton award requirement): triggered by
  RevenueCat's `initial_purchase`, message text **exactly**
  `THE SHIELD IS RAISED. YOUR VIGIL IS PROTECTED.` — this must match
  `PUSH_CAMPAIGN_LINES.plusWelcome` in `packages/core/src/copy.ts` verbatim.
  The repo is the source of truth; if they drift, fix the dashboard.
  Screenshot the live campaign for the Devpost entry.

### 4.4 Build and submit

```bash
cd apps/mobile
eas build --profile development --platform ios   # device testing
eas build --profile production --platform ios
eas submit --profile production --platform ios
```

`eas.json`'s `submit.production` is empty — it will prompt for the ASC app id
and Apple credentials on first run. SIWA capability comes from
`usesAppleSignIn`; push comes from the OneSignal plugin. `appVersionSource` is
`remote` and production `autoIncrement` is on, so build numbers are managed by
EAS.

### 4.5 Release ordering — this one bites

**Deploy the API before the mobile build reaches anyone.**
`RoundBoardSchema.rows` and `MeLedgerSchema.oracle` are *required* fields and
mobile parses strictly, so a mobile build ahead of the API deploy breaks the
ledger screen outright. Same for rules-version 2: settlement, reveal, board,
ledger and share all read it.

Order: migrate → deploy API → verify → build mobile → TestFlight → submit.

---

## 5. Validation debt

These are honestly unpaid, per `docs/gameplay/playtest-results.md`:

- **Human evidence: 0 participants, 0 sessions.** The five-person, two-session
  acceptance protocol in `docs/gameplay/playtest-protocol.md` has not run.
- **0 of 15 real candidate editorial reviews** (source quality and neutrality).
- **Accessibility passes not done**: VoiceOver operation, large text, reduced
  motion. Automated drag delivery was unreliable, so these were not claimed.
- **No uninterrupted full live round** — every walkthrough used synthetic
  local data.
- Native pending / missing-forecast / void-heavy scenarios unverified.
- Three Oracle-vs-player device surfaces still unverified because
  `oracle_p_yes` is null across dev — the Oracle's board row, the reveal's
  Oracle line, and the share-card line are all correctly *absent* until a real
  round runs.

The first real production round pays off most of the last three at once.

---

## 6. Shipaton submission

Deadline **Sept 30** via revenuecat-shipaton-2026.devpost.com.

- Devpost entry: description, demo video, screenshots.
- Judge offer codes for `plus_monthly` (§4.2).
- OneSignal campaign screenshot (§4.3).
- **The #BuildInPublic thread is blocked on nothing and is Erik's own
  first-person voice** — @ORACLE has still never posted, and that category's
  posts cannot be bought back retroactively. Start it today, independent of
  everything above.

---

## 7. Critical path

The gating chain is: Apple enrollment → ASC record → production build →
review. Everything else can run in parallel with it.

1. **Now** — Apple enrollment, RevenueCat, OneSignal, PostHog, Sentry, domain
   + privacy page. Start the #BuildInPublic thread the same day.
2. **Next** — prod Neon, migrate both DBs, deploy the Worker, verify Workflow
   bindings, smoke test.
3. **Then** — arm the pipeline and watch one supervised full day (publish →
   lock → settle) before trusting it unattended. Give it several days of real
   rounds so launch has true history behind it.
4. **In parallel** — ASC record and IAPs, RevenueCat/OneSignal wiring, EAS env
   vars, dev build on device, accessibility and five-person protocol.
5. **Target: submit to App Review by ~Sept 20.** Review turnaround is
   unpredictable and a rejection needs room for a resubmit. Everything after
   the 20th is buffer, not plan.
6. **Sept 25–30** — Devpost entry, video, screenshots, judge codes.

### If time runs short

Cut in this order — the first two cost nothing structural:

1. The Oracle's public record surfaces stay UNWRITTEN until 50 rated calls
   anyway; ten days of live rounds is not a prerequisite for shipping.
2. Push (OneSignal keys absent → the hinge push no-ops, nothing else changes)
   — but the OneSignal campaign is a Shipaton award requirement, so cut it
   only if you are also cutting that category.
3. Sentry (plugin drops itself without `SENTRY_ORG`).

Do **not** cut: the privacy URL, the RevenueCat webhook secret, or applying
migrations. Each of those fails silently or gets you rejected.
