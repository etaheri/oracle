# ORACLE Launch Playbook

Written Sept 7, 2026. Shipaton deadline **Sept 30, 2026**.

Consolidates and supersedes the account/dashboard half of
`docs/superpowers/plans/assets/revenue-rites/dashboard-runbook.md` (whose §5
is stale — the Sentry org and privacy URL are environment-driven now, not
source placeholders).

---

## 0. Where things actually stand

Verified Sept 15, 2026 (after the Hand merged and deployed):

| Thing | State |
|---|---|
| `origin/main` | `9966c41` — everything local is pushed (Plans 1–4: the House, mobile, the Council, the Hand) |
| Tests / typecheck | 1,434 pass (core 241 / mobile 453 / api 740); typecheck clean |
| Cloudflare Worker `oracle-api` | Deployed `254db119` from `434aca9` (model resolver every four hours) with all three Workflow bindings (`oracle-authoring`, `oracle-resolution`, `oracle-council`); `oracle-probe` deleted |
| Production Neon `oracle-prod` (`lively-river-29150895`) | Migrations 0000–0016 applied and journaled (`last created_at = 1789437975543`); 8 users, one stale v2 round (2026-09-09, still `open`) |
| Pipeline | `PIPELINE_ENABLED=true` set Sept 15 ~14:20 ET. First unattended authoring tick is 17:00 ET the same day; §3 supervision not yet done |
| Secrets | All of §2.5 set except `EXA_API_KEY` — the Council runs with empty evidence packs until it is |
| Site `outseen-site` | Deployed with the Hand's rules and the Standings link |
| EAS production env | `EXPO_PUBLIC_API_URL`, `_ONESIGNAL_APP_ID`, `_PRIVACY_URL`, `_RC_IOS_KEY` set |
| TestFlight | Build 11 (1.0.0) from `56f07d8` queued Sept 15 with auto-submit (reminder copy asks which side, not how sure); supersedes build 10. §4.6 device pass not yet done |
| Admin secret | The deployed `ADMIN_SECRET` is not the one in `.dev.vars`; manual `/admin/*` calls need the production value |

The critical path from here is §3 (watch the first day), §4.6 (device pass on build 10), then App Review.

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

Migrations 0000 through 0014 exist. Drizzle's relational query
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

### 2.3 Version 3 cutover (the House)

**`PIPELINE_ENABLED` is armed FIRST, before the manual deal.** The admin
authoring and forecast routes are pipeline routes: `buildPipelineDeps` returns
`undefined` while the flag is unset, and both
`POST /admin/rounds/:date/author` and `POST /admin/rounds/:date/forecast`
answer `503 {"error":"pipeline not configured"}`. Arming early is safe — the
cron only acts inside its scheduled hours (forecast 09:00–11:xx ET, publish at
noon, authoring at 17:00 ET, resolution after lock: exchange reads hourly, the model resolver every four hours), so between deploy and
the next of those hours it does nothing at all.

1. Apply `0014`, `0015` and `0016` to production: `cd apps/api && DATABASE_URL='<prod>' pnpm db:migrate`. `0016` is the Hand (design 2026-09-14 §7): best fortune and run start on `users`, the double and the bust on `user_rounds`, `doubled` on `predictions`, and the `guard_double` trigger. No data migration; production has no version 3 rows.

   **The silent failure.** `drizzle-kit migrate` exits `1` and prints nothing
   at all when a migration's schema is already applied to the database but its
   row is missing from `drizzle.__drizzle_migrations` — the DDL re-runs, the
   server rejects it (`column already exists`), and the CLI swallows the
   error. **Do not retry**: every retry fails the same way. Find the migration
   whose objects are already physically present, confirm it against
   `apps/api/drizzle/<tag>.sql`, and insert its bookkeeping row by hand, with
   the `hash` and the `created_at` that `apps/api/drizzle/meta/_journal.json`
   records for it:

   ```sql
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
   VALUES ('<sha256 of the .sql file>', <the `when` from _journal.json>);
   ```

   Then run `pnpm db:migrate` again for the migrations that genuinely remain.

   Verify, whichever path got you here:

   ```sql
   SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1;
   ```

   It must read `1789437975543` — `0016_whole_bishop`'s `when` in
   `apps/api/drizzle/meta/_journal.json` (2026-09-15T02:06:15.543Z). A smaller
   number means `0016` never landed and the Hand's columns are not there,
   whatever the CLI's exit code said.
2. Deploy the API.
3. Set `PIPELINE_ENABLED` to `true`: `echo -n true | npx wrangler secret put PIPELINE_ENABLED`.
   Wait for the new deployment to go live before the next step.
4. Deal tomorrow's round by hand and inspect it in Telegram:
   `curl -X POST -H 'x-admin-secret: …' https://<api>/admin/rounds/<tomorrow>/author`
   Then commit the forecast and the line:
   `curl -X POST … /admin/rounds/<tomorrow>/forecast` and `curl -X POST … /admin/rounds/<tomorrow>/line`
   Check `GET /admin/rounds/<tomorrow>` shows five questions with `market_source`, `market_id`, `line_p_yes`.
   A `503 {"error":"pipeline not configured"}` here means step 3 has not taken
   effect yet, not that the round failed.
5. Delete the retired probe Workflow from the account. Version 3 has no probe
   and `wrangler.jsonc` no longer binds it, so `oracle-probe` survives the
   deploy as an orphan that still holds any instances it had:
   `cd apps/api && npx wrangler workflows list` to confirm it is there, then
   `npx wrangler workflows delete oracle-probe` (deleting a Workflow also
   deletes its own instances). The dashboard's Workers → Workflows page does
   the same thing.
6. The round publishes at the next noon ET. The 17:00 ET tick deals the following day's round without help.
7. Ship the mobile build only after the API is live; the response schemas
   default every new field, so the old build keeps parsing in the meantime.
   **The build currently on the store renders a version 3 daily board empty** —
   it reads points and comparisons that a version 3 round no longer carries, so
   it shows 0 points and null comparisons. Parsing is safe; nothing crashes and
   nothing 500s. It stays that way until the mobile plan ships.
   The build on the store sends `confidence` and shows the ladder priced at
   the old fractions; the server ignores the number and stakes flat, so an
   old client's receipt may disagree with its ladder until it updates.

### 2.4 The Council (design 2026-09-11 §17)

1. Apply migration 0015 to `oracle-prod` by hand, as 0014 was.
2. `npx wrangler secret put EXA_API_KEY` in `apps/api`.
3. `pnpm --filter @oracle/api deploy`. The deploy creates the `oracle-council` Workflow from `wrangler.jsonc`. The deploy must register all three Workflow bindings (`oracle-authoring`, `oracle-resolution`, `oracle-council`); with any one missing, `buildPipelineDeps` falls back to running every kind inline inside the cron's 15-minute cap. Open `https://oracle-api.etaheri.workers.dev/standings`: it renders with zero calls.
4. On a day with a scheduled version 3 round, before noon ET: `curl -X POST -H "x-admin-secret: …" https://oracle-api.etaheri.workers.dev/admin/rounds/<date>/council`. Read the Telegram message: five packs with item counts, each member's line per slot, the median, the line, the Exa cost. Record the observed cost per pack here: ____ per pack, ____ per night.
5. After that round settles the next evening: `GET /admin/lessons` shows up to fifteen rows; `/standings` shows the first calls.
6. Add the Standings link on the site (`apps/site`) and `pnpm --filter site deploy`.
7. Ship the mobile build with the split and the reading.

### 2.5 Set secrets

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

**Question resolution pushes:** Each question now pushes its players the moment it resolves (yes/no). One push per player per question, composed from the `resolve` copy pool. The claim is idempotent — a single `UPDATE predictions SET resolve_pushed_at = now() WHERE resolve_pushed_at IS NULL AND points IS NOT NULL RETURNING` — so the hourly re-dispatch never double-sends. Admin resolves, withdrawals, and voids never trigger push. The settle-time hinge push (published round announcement) is unchanged. `GET /v1/me/ledger` now also returns `reading` — the player's latest locked-or-settled round with decided/total counts — which home uses for the IN PLAY line and the ledger CTA. Resolution pushes fire at whatever hour a question actually resolves, since exchange reads retry hourly and the model resolver every four hours until the void deadline — a late-verifiable question can push overnight. A quiet-hours delivery window is a follow-up, not yet implemented.

`PIPELINE_ENABLED` is armed in §2.3, before the manual deal — the admin
authoring and forecast routes 503 without it. §3 is where you watch the first
unattended cycle, not where you arm it.

### 2.6 Deploy

```bash
cd apps/api && pnpm deploy
```

Then **verify both Workflow bindings actually registered**
(`AUTHORING_WORKFLOW`, `RESOLUTION_WORKFLOW` — the probe binding is gone). A missing
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

### 2.7 Wire the URL back out

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
is covered as code and uncovered as operations. The old **$80–96/month**
estimate was dominated by the 4-hourly probe, which no longer exists: version 3
spends one voice call and one taste call on authoring, one forecast call before
noon, and two resolver reads per question at settle. The second resolver's Opus
call is now the largest line by some distance. **Re-measure against the first
armed week rather than trusting a figure derived from the old shape.**

It is already armed by §2.3. Watch one full cycle end to end:

```bash
cd apps/api
wrangler secret list | grep PIPELINE_ENABLED   # armed in §2.3
wrangler tail --format pretty
```

The cron fires every 10 minutes. The day's shape:

- **09:00–11:xx ET** — the Oracle's forecast is stamped, and `commitLine`
  writes the house line on the same tick. Hourly retries, all of them finished
  before players can see the round.
- **noon ET** — publish, on the first tick at or after noon. The forecast is
  already committed by then, which is the point: if you ever see one stamped
  *after* publish, the ordering regression is back (it used to trail every
  first-hour player).
- **17:00 ET** — authoring: the market round fetches both exchanges, picks
  five markets, and spends one voice call and one taste call on them. Once a
  night, not hourly. A night that cannot deal five falls through to the
  evergreen bank.
- **lock** — noon ET the next day, at the stated `locks_at`. Nothing pulls a
  lock forward any more; the probe that used to is retired.
- **settle** — retried for a full day after lock before a question voids at
  noon two days on: every question in the noon hour, then exchange reads
  hourly and the two-model read every four hours (`MODEL_RESOLVE_EVERY_HOURS`
  in `apps/api/src/pipeline/state.ts`), six model attempts instead of
  about twenty-four. A question carrying a `market_source` settles
  from the exchange it was dealt from, which is every question in an ordinary
  round. The two-model read is what remains for bank questions: two
  *different* models, and a disagreement resolves to unverifiable, never a
  winner. Never set `PIPELINE_RESOLVE_MODEL` and `PIPELINE_RESOLVE_MODEL_B` to
  the same model — that silently removes the error independence the second
  read buys.

`PIPELINE_DAILY_CALL_BUDGET` is 150, which caps an unattended retry storm.
Telegram is the operator console: `/status`, `/reroll <slot> [guidance]`,
`/flip <slot> <yes|no|void>`.

The market round's eligibility thresholds — the volume floor, the closing
window, the five-market round size — are first guesses. Plan to tune them off
the first live week, reading how many markets each exchange actually offers
inside the window.

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
| `EXPO_PUBLIC_SHARE_URL` | the site's `/play` smart link (see §4.1b), e.g. `https://outseen-site.etaheri.workers.dev/play`. Leave unset until it exists — absent ships a link-free share, which is correct |

Every native key is optional by design: an absent key means that SDK stays
dark and the app still runs. Absent is safe; wrong is not.

### 4.1b Share links

**Set the share URL and deployment path.** This controls the fallback the app shows when installed (a web link) and the smart link the share card opens.

- EAS environment: set `EXPO_PUBLIC_SHARE_URL=https://outseen-site.etaheri.workers.dev/play`.
  This is the `/play` smart link on the site — it opens the app when installed and
  otherwise shows a truthful fallback (web board).
- When a registered domain exists, set `EXPO_PUBLIC_SHARE_HANDLE` (a short ASCII
  display string printed on the share cards) and move `EXPO_PUBLIC_SHARE_URL` to that
  domain.
- In `apps/site/public/play.html`, fill `APP_STORE_URL` once the App Store listing
  is live (`https://apps.apple.com/app/id<ASC id>`).
- Deploy the site: `cd apps/site && npx wrangler deploy`.

**Snapshot and reminders.** Migration `0013` adds `predictions.crowd_yes_pct_at_seal`
and `predictions.crowd_count_at_seal` — a snapshot of crowd prediction and count
written at each seal, shown to the sealer only. The closing reminder follows the
device's habitual first-seal hour after three days of history (noon reminder unchanged).

Android still ships a link-free, text-free share: it goes through
`expo-sharing`'s `shareAsync`, which puts only the image file on the intent, so
the challenge line and `EXPO_PUBLIC_SHARE_URL` never travel there — only iOS's
`Share.share` carries both. A preview build with `EXPO_PUBLIC_SHARE_HANDLE` set
must be checked on a real device before turning it on for production: it is
the only way to see the rendered card at actual size and confirm the handle
clears the footer's lower boundary on both the round card and the plaque.

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

### 4.6 Device pass before the next App Store build

None of these are covered by the automated suite — confirm each on a real
device before the build ships:

- iOS share from both the reveal and the plaque shows the image and the
  challenge text together in Messages and Mail.
- The iPad share sheet presents correctly (not just the phone layout).
- `/play` opened from a Messages link works both with and without the app
  installed.
- `oracle://round` from a cold start lands on the round, not a blank screen.
- The finale movement line appears only after the seal, never before.
- Reminders fire at the device's habitual hour, and the noon reminder stays
  unmoved.

The Hand's three gesture checks (design 2026-09-14 §5.2, §5.3). The Simulator
could not perform any of them — a mouse drag does not carry the velocity the
release threshold reads, and the Simulator's tap does not reproduce the tray's
haptic. **Do all three on the first TestFlight install, before the build is
submitted to review:**

- A swipe released **past** the threshold seals the call and throws the card.
- A swipe abandoned **short** of the threshold springs the card back and seals
  nothing.
- A tap on a tray tile places the double and that tile reads `DOUBLED`.

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
