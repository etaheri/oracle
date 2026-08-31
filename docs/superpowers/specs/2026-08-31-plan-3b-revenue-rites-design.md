# Plan 3b — Revenue Rites: RevenueCat, OneSignal, Sign in with Apple, and the road to App Review

**Date:** 2026-08-31 · **Status:** approved by Erik (in-session) · **Approach:** "Store rails, custom chrome"

ORACLE ships to the App Store during the Shipaton window with a purchase powered by RevenueCat, a deployed OneSignal campaign, and a claimable record — while every judge-visible pixel stays ORACLE's. Award targets this plan serves: HAMM (Offerings-driven remote monetization + two revenue streams), OneSignal Keep Them Coming Back (SDK + deployed lifecycle campaign), Design (custom paywall, no template renderer), and the hard eligibility rule itself (RevenueCat SDK powers ≥1 purchase; first-ever store release in the window).

## 0. Decisions (made in-session, binding)

| Decision | Ruling |
|---|---|
| Paywall scope | **Shields + rescue IAP only.** Deep stats, archive, cosmetics = post-launch OTA. |
| Pricing | **$2.99/mo · $19.99/yr** (RevenueCat Offerings; server-side price tests later, no release). |
| Identity | **Device-only + dead-simple Sign in with Apple claim.** No sessions, no display names, no leaderboard identity (Plan 4). |
| Platforms | **iOS only.** Google Play deferred to traction. |
| Paywall renderer | **Custom in-brand screen driven by RevenueCat Offerings.** `react-native-purchases-ui` explicitly rejected: template layouts break the museum brand; the HAMM story (remote config/price tests) survives via Offerings alone. |
| Noon-hinge server push | **Stays unwired.** `apps/api/src/push/compose.ts` obligations + settle-atomicity precondition make it its own post-launch plan. The OneSignal award requirement is met by a deployed dashboard lifecycle campaign instead. |
| RevenueCat provisioning | **Direct account creation.** Stripe Projects $250 perk declined (credits only serve a web funnel we're not building). |

## 1. Scope

**In:** RevenueCat SDK + Offerings + entitlement webhook + custom paywall + shield-rescue IAP · OneSignal SDK + summons→prompt + RevenueCat lifecycle integration + one deployed campaign · Sign in with Apple claim/restore/delete · PostHog + Sentry · EAS dev client + build profiles · store assets + App Review submission.

**Out (explicit):** noon-hinge push, deep stats/archive/cosmetics, accounts UI beyond the three plaque rows, display names/leaderboard (earmarked Plan 4 as one package: `display_name` + claim + board), Android, marketing site.

## 2. RevenueCat

- **SDK:** `react-native-purchases` (no `-ui`). Configured at app start with **app user ID = device ID** (the UUID inside the signed device token — the server can already map it to a user via `devices.userId`). **Ruling:** the app user ID stays the device ID even across SIWA restore — no `Purchases.logIn` aliasing dance. The webhook resolves device→user server-side at write time, and a restored user's old purchases still recover via the Apple receipt (`restorePurchases`).
- **Products:** subscription group `oracle_plus` with `plus_monthly` $2.99 and `plus_annual` $19.99 (annual marked as the featured package); consumable `shield_rescue` (single streak save, price ~$1.99 — final price Erik's call in App Store Connect, spec default $1.99).
- **Entitlement:** one, named `plus`. Offering `default` carries both subscription packages; the rescue consumable is fetched as a product, not an offering package.
- **Webhook:** `POST /v1/webhooks/revenuecat` on the Worker. Auth: shared secret in the `Authorization` header (RevenueCat webhook config), constant-time compare. Handler maps `app_user_id` (device ID) → `devices.userId` → upserts `entitlements`: `plusActive` + `expiresAt` from subscription events (INITIAL_PURCHASE, RENEWAL, CANCELLATION→expiration, EXPIRATION, UNCANCELLATION, BILLING_ISSUE grace); `shieldsRemaining += 1` on `NON_RENEWING_PURCHASE` of `shield_rescue`. **Idempotency:** store processed RevenueCat event IDs in a new `webhook_events` table (id text PK, receivedAt) — neon-http has no transactions; check-then-insert marker pattern, same as the codebase's other idempotency markers. Unknown event types: 200 and ignore (never 4xx — RevenueCat retries).
- **Shield consumption:** `settleRound` already reads `entitlements` for paid shields. Plan 3b adds the decrement it was parked on: consuming a paid shield decrements `shieldsRemaining` (relative decrement, the parked 3b minor). Lapsed-subscriber policy (second parked minor): **shields bought remain usable after subscription lapse** (they're consumables — taking them back is the extortion the design spec forbids).
- **Judges:** App Store **offer codes** for `plus_monthly` created in App Store Connect; code goes in the Devpost submission.

## 3. The paywall (`/plus`)

- Reached from: the streak-at-risk / lapse notices on home, the plaque, and the rescue moment (below). **Never** an interstitial, never blocks play (design spec §5: the paywall protects investment, never access).
- Layout: in-brand — Cinzel numerals for prices, machine-voice copy, GoldButton purchase actions, DecodeLine print-in. Content driven by the fetched Offering (price strings always from StoreKit via RevenueCat — never hardcoded).
- Copy lives in `packages/core/src/copy.ts` under the existing copy-lint. **Lint ruling:** purchase-button labels are exempt from the no-CTA-verb rule via a new explicitly-marked `PAYWALL_CTA` pool (the lint's banned-verb list stays intact for everything else; the exemption is structural, not a lint weakening). Framing: "KEEP THE VIGIL" / shield language, no "subscribe now" idiom.
- Required chrome (App Review): Restore Purchases action, price + renewal disclosure text, Terms of Use (Apple standard EULA link) + Privacy Policy links. Privacy policy page must exist at a public URL by submission (one static page; where it's hosted is Erik's domain call — flagged in §9).
- **Rescue moment:** when home shows the streak-lapse notice and the user has no shield, one additional row offers `shield_rescue` (single purchase, immediate `shieldsRemaining+1`, settle logic already consumes it). High-intent placement; HAMM's second revenue stream.

## 4. Sign in with Apple — claim, not login

- **Module:** `expo-apple-authentication` (config plugin + capability in EAS credentials). iOS-only, matching the platform ruling.
- **Schema:** `users.appleSub text unique` (nullable). Retire `users.clerkId` (drop in the same migration — it was never written).
- **Endpoints (device-token-authed):**
  - `POST /v1/auth/apple/claim` — body: Apple identity token. Server verifies the JWT against Apple's JWKS (issuer `https://appleid.apple.com`, audience = bundle ID, expiry). If `sub` unbound → write to caller's user row. If bound to another user → 409 with the collision payload (below).
  - `POST /v1/auth/apple/restore` — same verification; re-points the calling **device** row's `userId` to the user bound to `sub`. The old (fresh) user row is abandoned. Device token remains the session credential — nothing else changes.
  - `POST /v1/auth/apple/strike` (account deletion, App Review 5.1.1(v)) — deletes the caller's predictions, entitlements row, devices, and user row. Confirmation is client-side ("THE RECORD WILL BE STRUCK · THIS IS NOT UNDONE").
- **Collision ruling:** the claimed record wins, never merged. If claim hits a bound `sub` and the current device has history, the client shows "THE RECORD ALREADY BEARS A NAME" and offers restore (adopt the bound record, abandon local) or cancel. No history merging, ever.
- **UI:** two plaque rows (`CLAIM YOUR RECORD` when unbound / `THE RECORD IS CLAIMED` when bound, `STRIKE THE RECORD` in a quiet footer position), plus a `RESTORE THE RECORD` row on the summons screen for fresh installs. Native Apple button per Apple HIG where the sheet is invoked (Apple requires their button style for the trigger).

## 5. OneSignal

- **SDK:** `react-native-onesignal` via config plugin. **External user ID = device ID** — one identity across RevenueCat, OneSignal, and the API. `oneSignalLogin` after device mint.
- **Permission:** the existing `/summons` interstitial remains the only ask; accepting it now actually triggers the OS prompt (`OneSignal.Notifications.requestPermission`). Declining never re-asks (existing flag honored).
- **RevenueCat → OneSignal integration** enabled in the RevenueCat dashboard, so subscription lifecycle events land as OneSignal tags/data.
- **Deployed campaign (the award requirement):** one dashboard-built lifecycle campaign live before submission — trigger: `initial_purchase` tag → machine-voice welcome push. Copy authored in `copy.ts` under the lint, then pasted into the dashboard (source of truth stays the repo). Screenshot the live campaign config for the Devpost entry.
- Local scheduled reminders (`src/notifications/schedule.ts`) continue unchanged alongside — they are local, not remote; no conflict.
- `composeHingePushes` stays intentionally unwired; its four obligations remain in the file header for the post-launch push plan.

## 6. PostHog + Sentry

- `posthog-react-native`, key via EAS env. Events (spec vocabulary): `round_opened`, `question_answered`, `round_locked`, `reveal_viewed`, `card_shared`, `paywall_viewed`, `purchase_completed`, `shield_used`, `record_claimed` (no free trial at launch — judges use offer codes; if a trial is later added via Offerings config, `trial_started` joins then). One dashboard: D1/D7, share rate, completion, conversion — the kill-gate's four numbers.
- `@sentry/react-native` on mobile (EAS source maps) + Sentry on the Worker. Distinct identify: device ID only, never Apple sub or email.

## 7. Build, release, review

- **This plan ends Expo Go.** RC/OneSignal/SIWA are native modules → EAS **dev client** is Task 1; every later task is verified inside it. Build profiles: `development` (dev client), `preview` (internal), `production`. `app.json` → `app.config.ts` if needed for plugin config; iOS privacy manifest declarations for the new SDKs.
- **App Store Connect:** app record, bundle ID `com.eriktaheri.oracle` (Erik confirms/overrides at enrollment), IAP products (§2), offer codes, screenshots 1179×2556 frameless, App Privacy questionnaire (device identifiers, purchases, diagnostics; no tracking → no ATT).
- **Review-proofing rulings:** (1) the prod pipeline is armed (secrets + `PIPELINE_ENABLED`) **before** submission — a reviewer must never see THE ORACLE SLEEPS with no countdown to a real round; (2) review notes include a walkthrough, the offer code, and the explanation that content rotates daily at noon ET; (3) no betting vocabulary anywhere in listing or app (design spec §5a.4).
- **Branch reality:** 3b work builds on top of `gameplay-audit-fixes` (27 commits, unmerged pending Erik's hand-check playthrough). Merging that branch to main first is strongly preferred — flagged as a §9 Erik item; if not merged, 3b branches from it, not from main.

## 8. Testing

- **Pure/unit (TDD):** webhook handler against fixture RevenueCat events (all event types + idempotent replay + unknown-type 200), Apple JWT verification (fixture JWKS), claim/restore/strike logic, shield decrement, copy-lint coverage of all new pools.
- **Manual dev-client passes (per mobile convention):** sandbox purchase + restore (StoreKit configuration file locally, sandbox account on device), rescue purchase at a real lapse, SIWA claim/restore/strike, push permission flow + test push, paywall price display from Offerings.
- **Pre-submission checklist:** live round in prod, webhook receiving sandbox events, campaign deployed, offer code redeems.

## 9. Erik-gated items (the plan cannot start some tasks without these)

1. Apple Developer enrollment (blocks EAS credentials, ASC, SIWA capability, IAP).
2. RevenueCat account + project (direct, not Stripe Projects) — then API keys + webhook secret.
3. OneSignal account **via the Shipaton perk link** (Growth plan free) — then app ID + keys.
4. PostHog + Sentry projects/keys.
5. Domain + a public privacy-policy URL.
6. Merge-or-branch call on `gameplay-audit-fixes`.
7. Prod pipeline secrets (`ANTHROPIC_API_KEY`, Telegram set, `PIPELINE_ENABLED`) before submission week.

## 10. Success criteria

- Sandbox → real purchase flows through RevenueCat into `entitlements` and a paid shield survives a missed day.
- OneSignal campaign deployed and received on a real device.
- SIWA claim → wipe → restore round-trips a streak.
- App submitted to App Review by **Sept 15–19** with all §7 review-proofing in place.
