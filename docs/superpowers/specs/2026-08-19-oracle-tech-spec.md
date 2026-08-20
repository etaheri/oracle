# ORACLE — Technology Spec

**Date:** 2026-08-19
**Companion to:** `2026-08-09-oracle-design.md` (product/design spec)
**Verified current:** Expo SDK 57 · React Native 0.86 · React 19.2 · Reanimated 4.5 · RN Skia ≥2.10 (as of Aug 2026)

## 1. Monorepo

pnpm workspaces, TypeScript strict everywhere, one repo:

```
oracle/
  apps/
    mobile/      # Expo app (SDK 57)
    api/         # Hono on Cloudflare Workers (+ Durable Objects, Cron)
    web/         # Astro marketing site (Cloudflare)
    admin/       # Vite React admin behind Cloudflare Access
  packages/
    core/        # shared: zod schemas, API types, scoring math (unit-tested), constants
  docs/superpowers/specs/
```

`packages/core` is the load-bearing package: the **scoring math (Brier + contrarian bonus + streak logic) lives here once**, imported by both api (authoritative) and mobile (optimistic display), with the heaviest unit-test coverage in the repo. Zod schemas define every API payload; types are inferred, never hand-written twice.

## 2. Mobile app (`apps/mobile`)

**Platform:** Expo SDK 57, React Native 0.86, React 19.2, **New Architecture** (mandatory — Reanimated 4 dropped the legacy renderer). EAS Build + **dev client** (required: RevenueCat, OneSignal, Skia are native modules — no Expo Go). **EAS Update** with `production` / `preview` channels for OTA iteration during the traction window.

**Dependencies (majors pinned; take latest minors at scaffold time via `npx expo install`):**

| Concern | Choice | Notes |
|---|---|---|
| Navigation | `expo-router` (file-based) | Typed routes on; deep links fall out of file structure |
| Motion | `react-native-reanimated@4` + `react-native-worklets` | All UI motion; UI-thread worklets |
| Pixels | `@shopify/react-native-skia@≥2.10` | Grain + gold-shimmer shaders, text-orb, offscreen share-card PNG (`makeImageSnapshot`) |
| Purchases | `react-native-purchases` + `react-native-purchases-ui` | RevenueCat + **RevenueCat Paywalls**: paywall layout/copy/price tests configured server-side, no app release — this is the HAMM-award story |
| Push | `react-native-onesignal` | Daily drop + results pushes; OneSignal award alignment |
| Analytics | `posthog-react-native` | D1/D7 retention, share rate, completion funnels |
| Crashes | `@sentry/react-native` (sentry-expo integration) | Plus source maps via EAS |
| Auth | `@clerk/clerk-expo` | Sign in with Apple, Google, email code; anonymous device id → account merge |
| Server state | `@tanstack/react-query@5` | Round fetch/cache, optimistic submission, retry with idempotency key |
| Client state | `zustand` | Tiny: in-round answers, boot state |
| Images | `expo-image` | Sibyl/painting assets: bundled compressed, memory-cached |
| Haptics | `expo-haptics` | Lock-in thunk, reveal tick — ritual feel |
| Sharing | `expo-sharing` + Skia snapshot | Share sheet with generated PNG |

**Fonts:** **ABC Arizona Flare** (Dinamo; 2 static weights, display/temple voice) + **IBM Plex Mono** (machine voice). Loaded via `expo-font` config plugin (embedded at build, no FOUT). Licensing: Dinamo **App/Game license** required before any store build ships the font (trial fonts for local mockups only); **Web license** if the marketing site uses live-text Arizona (or render it into images to skip it). Optional: variable superfamily instead of statics unlocks sans↔serif axis-morph (RN Skia variable-axis if workable, else stepped instances) — nice-to-have only. Fallback if licensing stalls near deadline: Cinzel (open) — ship dates beat fonts.

**Store/config:** `app.json` → app.config.ts; iOS `associatedDomains` for universal links; Android intent filters for app links; privacy manifest (Apple requires API-usage declarations); `expo-notifications` entitlements via OneSignal plugin.

## 3. Backend (`apps/api`)

**Runtime:** Cloudflare Workers, **Hono** router, TypeScript, zod validation at every boundary (schemas from `packages/core`).

- **Database: Neon Postgres** via **Drizzle ORM** + Neon serverless HTTP driver (no TCP pooling headaches on Workers). Migrations: `drizzle-kit` checked into repo, applied in CI.
- **Hot path is cached:** today's round JSON is served from the edge cache/KV (rebuilt on question publish), so the noon spike never touches Postgres for reads. Writes (predictions) go straight to Neon with server timestamps + idempotency keys.
- **Durable Objects:** one per daily round — live player counter and drifting crowd percentages over SSE. (Alarms handle round lock at `locks_at`.)
- **Cron Triggers:** noon drop publish; resolution polling (sports/weather/market APIs); Hermes agent runs (question drafting); aggregate recompute (Oracle Score, the Oracle's own prophecy weights).
- **Auth:** Clerk JWT verification middleware (JWKS cached); anonymous requests carry a signed device token minted on first launch.
- **Scoring runs only here.** Client shows optimistic UI; the server's number is the number.

## 4. Marketing site (`apps/web`)

**Astro on Cloudflare** (static-first, zero client JS by default — it's a content site, not an app). Jobs, in priority order:

1. **Share-link landing: `/q/:roundId`** — the viral loop's web half. Renders the receipt (server-side), smart-redirects: app installed → universal link opens today's round; not installed → App Store. This page is why the marketing site exists.
2. **OG images** — per-share dynamic unfurl images (the terminal-receipt look) generated at the edge with `workers-og` (Satori-style SVG→PNG). Link previews in iMessage/X/Discord *are* the marketing.
3. **Universal-link plumbing** — hosts `/.well-known/apple-app-site-association` and `assetlinks.json`.
4. **Pre-launch:** waitlist page (email → Neon table) while the @ORACLE poll ritual runs; **post-launch:** landing page in the digital-antiquity language (sibyl + mono annotations + store badges), press kit page for Devpost/judges.

Domain: buy one now (e.g. `consulttheoracle.app` / `oracle.game`-class); universal links need it live and stable before the first TestFlight build ships.

## 5. Admin (`apps/admin`)

Small Vite React SPA behind **Cloudflare Access** (zero-build auth: Google login allowlist of one). Screens: question queue (approve/edit/reorder Hermes drafts), resolution confirm (pre-fetched source data + one click), void button, basic health (today's counts). No design budget — it's a tool.

## 6. Hermes agent

A **scheduled Worker** (cron, mornings) calling the Anthropic API (Claude Sonnet 5 — drafting questions is not frontier-model work; upgrade only if quality demands). Inputs: news/sports/weather feeds + Manifold & Kalshi public APIs (trending markets = candidates; live probabilities = difficulty gauge). Output: staged rows in `question_drafts` with resolution criteria + named source — never directly live. Resolution automation follows the bright line from the design spec: auto-resolve only API-attestable outcomes; judgment goes to admin confirm. The agent being down never breaks the drop (24h+ approved-question buffer).

## 7. Testing & CI

- **Vitest**: `packages/core` (scoring — the highest-stakes tests in the repo: proper-scoring properties, contrarian bonus, streak/shield/void edge cases) and `apps/api` (Workers pool/miniflare: submission lifecycle, lock rejection, idempotency).
- **Maestro**: one mobile E2E happy path (open → answer 5 → lock → reveal) on the dev client; run pre-release, not per-commit.
- **GitHub Actions**: typecheck + lint (`eslint-config-expo` + Prettier — match Expo defaults, don't invent) + Vitest on every push; `drizzle-kit` migration check; EAS Build on release tags; EAS Update publish on merge to main (preview channel).
- **RevenueCat sandbox** + StoreKit config file for local paywall testing.

## 8. Environments & secrets

- Workers: `wrangler.jsonc` per-env (`dev`/`production`), secrets via `wrangler secret` (Anthropic key, Clerk secret, OneSignal key, sports/weather API keys).
- Mobile: EAS environment variables/secrets per channel; no secrets in the bundle — the app talks only to our API (RevenueCat/OneSignal/PostHog public SDK keys are the only client keys, as designed by those vendors).
- Neon: separate branch databases for dev/preview (Neon branching) — prod schema changes rehearse on a branch first.

## 9. Observability

Sentry (mobile + Workers), PostHog (product events: `round_opened`, `question_answered`, `round_locked`, `reveal_viewed`, `card_shared`, `paywall_viewed`, `trial_started`, `shield_used`), Workers Logs for the API, RevenueCat dashboard as revenue source-of-truth (also what Shipaton judges read). One PostHog dashboard: D1/D7, share rate, completion, conversion — the four numbers the experiment lives on.

## 10. Build order (compressed for Sept 30)

1. **Today:** Apple Developer enrollment; domain purchase; @ORACLE account + first poll; repo scaffold (`pnpm` + Expo SDK 57 + Hono + Astro skeletons).
2. **Days 2–7:** `packages/core` scoring w/ tests → api schema + round endpoints → mobile core loop (predict → lock → crowd reveal) with placeholder styling → TestFlight build #1.
3. **Days 8–14:** results/reveal + streaks + share cards (Skia) → RevenueCat paywall + Oracle Plus → OneSignal + PostHog → digital-antiquity pass (grain, gold, sibyls) → store assets → **submit to App Review**.
4. **Remaining ~4 weeks:** public launch, daily ops live, leaderboard + Oracle's prophecy + Beat-the-Oracle, marketing site share pages + OG images, growth iteration via OTA, Personal Prophecies drop, Devpost submission by ~Sept 27.
