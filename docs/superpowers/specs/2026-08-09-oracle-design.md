# ORACLE — Design Spec

**Date:** 2026-08-09
**Status:** Draft for review
**Context:** Entry for [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com). Submission window closes **Sept 30, 2026, 11:45pm PDT**. The app must be a brand-new mobile app, first publicly released during the window, with the RevenueCat SDK powering at least one in-app purchase.

## 1. Product overview

ORACLE is a free daily prediction game. Every day, five questions about tomorrow drop at a fixed global time. Players answer yes/no with a confidence slider, see how they compare to the crowd, and return the next day for results. Over weeks, a calibration-based leaderboard reveals who can actually tell the future.

**Positioning:** "Wordle for predictions." Prediction markets (Kalshi, Polymarket, ~50M combined users in 2026) made forecasting mainstream, but every major player is a money/trading product. ORACLE is the free, casual, status-driven on-ramp. No money is ever staked on predictions — it is a status game, not gambling.

**Primary goal:** Maximize traction (installs, retention, revenue) during the Shipaton window, since the Grand Prize shortlist is built from RevenueCat-reported revenue and growth momentum during Aug 1–Sept 30.

**Target awards:** Grand Prize, Best Game, HAMM, #BuildInPublic, OneSignal "Keep Them Coming Back," Most Viral App.

## 2. Core loop — the event drop

The daily round is designed as a *live-feeling event*, not a passive puzzle (but with a 24h window so no one's day is ever forfeit — the lesson of HQ Trivia's daily-appointment death spiral).

**A day in ORACLE:**
- **11:45am ET — the summons.** Push: "The Oracle speaks in 15 minutes." Opening early lands in a pre-drop lobby: category teasers, countdown, live counter of waiting players.
- **12:00pm — the drop.** Yesterday's **results reveal first** (dopamine before commitment, performed with ceremony — not buried in a list), then today's questions animate in.
- **The reveal.** While answering, players see the live player counter but never the crowd split. On locking the fifth answer, crowd percentages slide in — and keep drifting live as more players lock in all day (a reason to reopen at 9pm; harmless since you're locked).
- **First hour (until 1pm).** Locking in during the first hour earns the **First Hour Oracle** badge on the share card plus a daily-points bonus. This both drives the noon event culture and compensates early players' information disadvantage (an 11pm answer has strictly more information than a 12:05pm one).
- The live counter runs on a Durable Object per round; the lobby and reveal are cheap UI, not live-ops.

1. **The Daily Five** drops at one fixed global time (like Wordle's single daily puzzle). Four quick questions across rotating categories (markets, sports, weather, pop culture, news) plus **The Big One** — always tied to the current news cycle, worth double points, featured on the share card. Every question resolves within 24–48 hours.
2. For each question the player picks **yes/no plus a confidence level** (slider, 55%–95%). Crowd percentages are hidden until the player locks in, then revealed immediately — dopamine hit #1 ("you vs. the crowd").
3. **Next day:** results reveal — dopamine hit #2. Points, streak update, Oracle Score movement, and a shareable result card.
4. **Share card:** an image generated in-app for the OS share sheet, e.g. `🔮 ORACLE #47 — 4/5 · called The Big One with the 22%`. The card carries the App Store link. Receipts culture ("I called it") is the viral engine.

A daily round takes about 90 seconds. Because questions resolve fast, every day contains both a predict moment and a reveal moment.

## 3. Scoring — two economies, one wall

The fun economy and the truth economy are strictly separated. This wall is simultaneously the game-design guardrail (credibility of "who can tell the future") and the legal guardrail (see §5a): **nothing purchasable or hustle-based ever touches the stat that prizes key off.**

- **Fun economy — daily points, streaks, badges.** Luck and hustle welcome: first-hour bonus, contrarian daily bonuses, streak play. Streak Shield (paid) touches only this economy. No cash prize ever keys off it.
- **Truth economy — Oracle Score:** long-run skill metric using a proper scoring rule (Brier-based, surfaced with a human name and 0–1000-style scale). Pure calibration-weighted accuracy — no earliness bonus, no streak input, nothing purchasable affects it. Properties:
  - Honest confidence is mathematically the optimal strategy (being wrong at 95% hurts far more than at 60%).
  - **Contrarian bonus:** extra points for being right when the crowd majority was wrong. Makes real skill visible fast and generates the best share moments.
  - Becomes statistically meaningful after ~50 predictions — which is itself a retention mechanic ("your Oracle rank unlocks at 50 calls").
- **Leaderboards:** global and weekly, by Oracle Score, with streak shown.
- **Tone — mystic-playful.** The oracle theme with a wink, carried through all copy, notifications, and share cards. Title ladder by Oracle Score percentile (unlocks after 50 calls): **Apprentice → Augur → Seer → Oracle → The Prophet.** Notification voice: "The Oracle speaks in 15 minutes."

## 3a. Prizes

- **At launch — status only:** title ladder, **Oracle of the Week** (featured profile + permanent badge), all-time Hall of Fame. Legally inert, and status is on-theme: the whole premise is a status game.
- **Mid-window, if traction — small fixed cash:** "Oracle of the Month wins $500," keyed to **Oracle Score only** (never streaks — see §5a). Monthly horizon, not weekly: a week is ~35 predictions and luck-heavy; a month gives skill room to show, and fewer/bigger prize events are cleaner legally and operationally.
- **Post-traction roadmap — The Grand Oracle (weekly live show, weeks 5+):** live *results* show, not a prediction show — resolution is where the drama lives (predictions can't be resolved live; this is why HQ-style live doesn't map directly). Sunday 8pm ET: the week's Big Ones revealed dramatically, contrarian heroes named, Oracle of the Week crowned live, and one mega-question that locks during the show — the one true moment of simultaneous commitment.

## 4. Identity

Play-first: the app is fully playable on first open with device-based identity (anonymous). Creating an account (email magic link / Sign in with Apple / Google) claims the history, enables leaderboard placement, and survives device changes. Device history merges into the account on signup. Sign in with Apple is required by App Review whenever third-party login is offered.

## 5. Monetization — "Oracle Plus" (RevenueCat)

RevenueCat SDK powers all purchases. Free tier keeps the complete daily game; the paywall protects *investment and insight*, never access.

**Oracle Plus subscription (monthly + discounted annual):**
- **Streak Shield** — miss a day, keep your streak (auto-applied, N per month). The single most proven daily-game monetizer (Duolingo pattern).
- **Deep stats** — personal calibration curve, category strengths, percentile history, head-to-head vs. the crowd.
- **Archive access** — browse past questions and your full prediction history.
- **Cosmetics** — oracle themes/app icons.

**One-time IAP:** single Streak Shield "rescue" purchase at the moment a streak is about to break (high-intent moment; also demonstrates diversified revenue for the HAMM award).

Judges receive a promo code for Oracle Plus (submission requirement).

## 5a. Legal guardrails (prizes & gambling)

Doctrine: illegal gambling requires **consideration + chance + prize**; remove any one element and it is not gambling. ORACLE's safe harbor is removing *consideration* — free entry always — making any prize competition a promotional sweepstakes (the McDonald's Monopoly category). Do not rely on skill-game exemptions (state-by-state swamp).

Hard rules, enforced by design:
1. **Paying never improves prize eligibility.** Cash prizes key off Oracle Score only; Oracle Plus (incl. Streak Shield) touches only the fun economy. If payment could enhance contest standing, consideration creeps back in and the structure fails.
2. **Users never stake money on predictions.** Outcome-contingent payouts of user money are the licensed prediction-market business (CFTC territory). Never.
3. **When cash prizes launch:** official rules page linked in-app, "no purchase necessary," 18+, void where prohibited, US-only initially, 1099 for winners over $600/year. Fixed modest prizes keep this trivial; registration/bonding thresholds (NY, FL, ~$5K+) only matter at jackpot scale. One hour with a lawyer before the first cash prize.
4. **App Review:** Apple guideline 5.3 permits developer-sponsored contests with in-app rules. Keep betting vocabulary ("bet," "odds," "wager," "payout") out of the app and store listing entirely.

## 6. Question operations (the daily treadmill)

- An LLM pipeline drafts ~10 candidate questions each morning from news/sports/markets/weather feeds. **Every candidate includes explicit resolution criteria and a named data source at creation time** — this discipline prevents adjudication fights.
- Operator (Erik) approves five per day in a minimal admin web view. Target: under 15 minutes/day. Questions are queued at least 24h ahead so a missed morning never breaks the drop.
- **Resolution** is semi-automated: market close, weather, and sports scores fetched from APIs; one-click confirm in admin. Anything ambiguous is **voided** — no points, clearly labeled in-app, never argued.
- Questions must be globally unambiguous (UTC-defined cutoffs, named sources: "per NWS", "per official box score").

## 7. Architecture

**Mobile app:** Expo / React Native, TypeScript. One codebase → iOS + Android. EAS Build for store builds; EAS Update (OTA) for rapid iteration during the traction window without waiting on App Review.

**Backend:** TypeScript API (Hono on Cloudflare Workers) + **Neon Postgres**. A Durable Object per daily round powers the live player counter and drifting crowd percentages (SSE/WebSocket). Server-authoritative for everything that matters: question open/close times, submission timestamps, scoring, aggregates. The app never computes its own score.

**Services:**
- **RevenueCat** — subscriptions/IAP (required).
- **OneSignal** — push: daily drop alert + results-ready alert (the two dopamine hits, delivered). Also targets the OneSignal sponsored award.
- **PostHog** — analytics. The experiment lives on three numbers: **D1/D7 retention, share rate, round completion rate.**
- **Clerk (or equivalent)** — auth: Sign in with Apple, Google, email magic link, with anonymous-device → account merge.

**Admin:** minimal web app (same Workers backend) for question approval and resolution confirmation.

**Data model (core tables):**
- `users` — id, auth ids, device ids, created_at, streak fields, oracle_score aggregates
- `questions` — text, category, is_big_one, opens_at, locks_at, resolves_by, resolution_criteria, resolution_source, outcome (yes/no/void), status
- `predictions` — user_id, question_id, answer, confidence, created_at (server), score
- `daily_rounds` — date, question ids, aggregate crowd stats

## 8. Error handling & edge cases

- **Late joiners:** can always play today's round; no back-filling past days.
- **Timezones:** one global day defined in UTC; drop time is **noon ET** (16:00 UTC), locks at the next drop.
- **Void questions:** no points for anyone, labeled "VOID" with a one-line reason; streak credit still granted for having played.
- **Missed resolution data** (API down): admin resolves manually; round reveal can be late but never wrong.
- **Offline / flaky network:** round is fetched and cached on open; submissions retry with idempotency keys; a submission after `locks_at` (server clock) is rejected with a friendly "the oracle has closed" state.
- **Anti-cheat (v1 scope):** server-side lock times and timestamps only. One submission per user/device per question. No answer changes after lock.

## 9. App Review risk notes

- No staked money, no monetary prizes, no odds-based payouts → not gambling under store guidelines. Copy must avoid betting language ("bet," "odds," "wager") in store listing and app.
- Sign in with Apple included.
- Subscription screens follow Apple's required disclosure format (price, term, restore button).
- **Google Play risk:** new personal developer accounts must run a closed test (12+ testers, 14 days) before production release. If the Play account is new, start closed testing in week 1 or accept iOS-only for the window. iOS is the primary target regardless.

## 10. Timeline (7.5 weeks)

- **Week 1 (Aug 10–16):** Apple Developer + Play accounts *immediately* (approval latency). Expo scaffold, core loop UI (round → predict → lock → crowd reveal), backend schema + endpoints, question pipeline v0 (manual entry acceptable).
- **Week 2 (Aug 17–23):** results/reveal flow, streaks, share cards, RevenueCat + Oracle Plus paywall, OneSignal, PostHog. TestFlight to friends. Store assets (icon, screenshots). **Submit to App Review.**
- **Week 3 (Aug 24–30):** ship v1.0 publicly (target: live by ~Aug 28). Begin daily question ops for real. Begin #BuildInPublic posting — including the meta-move: publicly predicting ORACLE's own metrics in the app.
- **Weeks 4–7 (Sept):** iterate on retention/share loop via OTA updates, leaderboard, Oracle Score reveal at 50 calls, Oracle of the Week, growth experiments, LLM question pipeline. If traction: Oracle of the Month cash prize (after §5a checklist + lawyer hour) and a first Grand Oracle live results show as a #BuildInPublic event. Record 2-min demo video, prep Devpost submission (icon 1024², screenshot 1179×2556, promo code, category descriptions, #BuildInPublic post links). **Submit by ~Sept 27** (buffer before the 30th deadline).

## 11. Testing

- Unit tests for scoring (proper scoring rule, contrarian bonus, streak logic, void handling) — this math must be provably right or the leaderboard is meaningless.
- Integration tests for the submission lifecycle (open → predict → lock → resolve → score) including lock-time rejection and idempotent retries.
- Manual device passes for the paywall (RevenueCat sandbox), push, share sheet, and anonymous → account merge.

## 12. Explicitly out of scope (v1)

User-submitted predictions, comments/social feed, real-money anything, private leagues, native widgets, web app, the talent/data business, localization. All wait until the loop proves it retains.

## 13. Success criteria

- App live on the App Store during the Shipaton window (hard requirement).
- RevenueCat-powered subscription live with ≥1 real purchase.
- D1 retention > 40%, D7 > 20% among users acquired via share links (the experiment's core hypothesis).
- Devpost submission complete with all assets before Sept 30.
