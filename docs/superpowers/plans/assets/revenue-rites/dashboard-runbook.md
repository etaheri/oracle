# Dashboard Runbook — Revenue Rites

Ordered, copy-paste-ready record of the steps gated on Erik's own accounts
and dashboards. This is Task 12 of the revenue-rites plan
(`.superpowers/sdd/2026-08-31-revenue-rites/task-12-brief.md`). Nothing here
blocks Tasks 1–11; the code and docs those tasks touch are already in place.
This document is the checklist to execute once Erik is ready to do the
account/dashboard work himself (or hand it to an executor with real
credentials).

Work through the sections in order — later steps depend on IDs and secrets
created in earlier ones.

---

## 1. Erik account checklist (in order)

1. **Apple Developer enrollment** — required before App Store Connect or
   EAS builds with capabilities (SIWA, push) will work.
2. **RevenueCat account — DIRECT signup, NOT via Stripe Projects.** This was
   decided in the plan spec §0: RevenueCat's Stripe-Projects path provisions
   a different account shape than what this integration expects. Sign up at
   revenuecat.com directly, then create the iOS app inside it with bundle id
   `com.erikt.oracle`.
3. **OneSignal account via the Shipaton perk link** (gets the free Growth
   plan tier — do not sign up through the normal onsignal.com flow, use the
   Shipaton-provided link so the perk applies). Create the iOS app inside it.
4. **PostHog project** — standard signup, note the project API key.
5. **Sentry org + project** — project must be named `oracle-mobile`.
6. **Domain + public privacy-policy URL** — needs to be a real, publicly
   reachable URL; it goes into the App Store Connect privacy questionnaire
   and into the mobile app's Plus paywall screen (see §5 below).

---

## 2. App Store Connect

- Create the app record (bundle id `com.erikt.oracle`).
- Subscription group `oracle_plus`, containing:
  - `plus_monthly` — $2.99
  - `plus_annual` — $19.99
- Consumable in-app purchase: `shield_rescue` — $1.99.
- Offer codes for `plus_monthly` (for judges evaluating the Shipaton entry).
- App Privacy questionnaire answers:
  - Identifiers: **device ID** — collected.
  - **Purchases** — collected.
  - **Diagnostics** — collected.
  - **Tracking: NO** — this means no ATT (App Tracking Transparency) prompt
    is needed; do not enable tracking-linked data types.

---

## 3. RevenueCat dashboard

- Entitlement `plus`, attached to both subscription products
  (`plus_monthly` and `plus_annual`).
- Offering `default`, with the annual product (`plus_annual`) set as
  featured/highlighted.
- Webhook:
  - URL: `https://<prod-worker-domain>/v1/webhooks/revenuecat`
  - Header: `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`
- Enable the OneSignal integration inside RevenueCat, using **external-id
  mode** (so RevenueCat's customer id matches OneSignal's external user id).
- Server secret — run from `apps/api`:
  ```
  wrangler secret put REVENUECAT_WEBHOOK_SECRET
  ```
  Paste the same secret value used in the webhook Authorization header above.
- Optional — only needed if the real bundle id ever differs from the
  default baked into `apps/api/src/routes/auth.ts` (`com.erikt.oracle`):
  ```
  wrangler secret put APPLE_BUNDLE_ID
  ```
  (As of this task, `WorkerEnv`/`AppEnv` already thread `APPLE_BUNDLE_ID`
  and `REVENUECAT_WEBHOOK_SECRET` through the worker — see
  `apps/api/src/worker.ts` — so setting these secrets is sufficient; no
  further code change is needed.)

---

## 4. OneSignal dashboard

- Build the deployed lifecycle campaign (this is a Shipaton award
  requirement — spec §5):
  - Trigger: the RevenueCat `initial_purchase` event/tag (arrives via the
    OneSignal integration enabled in §3).
  - Message text, **exactly**:
    ```
    THE SHIELD IS RAISED. YOUR VIGIL IS PROTECTED.
    ```
    This must match `PUSH_CAMPAIGN_LINES.plusWelcome` in
    `packages/core/src/copy.ts` verbatim. The repo is the source of truth —
    if the two ever drift, fix the dashboard to match the repo, not the
    other way around.
- Screenshot the live campaign configuration (trigger + message) and drop
  the image into this `assets/revenue-rites/` directory for the Devpost
  entry.

---

## 5. EAS env (per build profile)

Set for each relevant EAS profile (development / preview / production, as
applicable):

- `EXPO_PUBLIC_RC_IOS_KEY`
- `EXPO_PUBLIC_ONESIGNAL_APP_ID`
- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_API_URL=<prod worker URL>`

Then fill in the two remaining placeholders in the mobile app source:

- `apps/mobile/app.json` — replace `SENTRY_ORG_TBD_BY_ERIK` with the real
  Sentry org slug from §1.5.
- `apps/mobile/src/app/plus.tsx` — replace
  `https://PRIVACY_URL_TBD_TASK_12` with the real privacy-policy URL from
  §1.6.

---

## 6. First dev build

```
eas build --profile development --platform ios
```

- SIWA (Sign in with Apple) capability is picked up automatically from
  `usesAppleSignIn` in the app config.
- Push capability is picked up automatically from the OneSignal Expo
  plugin.

Once the build finishes, install it on Erik's device, then from
`apps/mobile`:

```
npx expo start --dev-client
```

---

## 7. Migrations

Apply Drizzle migration `0004` (and any other pending migrations) to both
the dev and prod Neon databases by hand via `psql`, following the existing
project convention — there is no `__drizzle_migrations` bootstrap/runner
wired up yet, so this stays a manual step for now.

---

## 8. Cross-reference

Once every step above is complete, continue to **Task 13** in the
revenue-rites plan for the device-pass checklist and App Store submission
steps.
