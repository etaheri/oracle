# ORACLE — Design Spec

**Date:** 2026-08-09
**Status:** Draft for review
**Context:** Entry for [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com). Submission window closes **Sept 30, 2026, 11:45pm PDT**. The app must be a brand-new mobile app, first publicly released during the window, with the RevenueCat SDK powering at least one in-app purchase.

## 1. Product overview

ORACLE is a free daily prediction game. Every day, five questions about tomorrow drop at a fixed global time. Players answer yes/no with a confidence slider, see how they compare to the crowd, and return the next day for results. Over weeks, a calibration-based leaderboard reveals who can actually tell the future.

**Positioning:** "Wordle for predictions." Prediction markets (Kalshi, Polymarket, ~50M combined users in 2026) made forecasting mainstream, but every major player is a money/trading product. ORACLE is the free, casual, status-driven on-ramp. No money is ever staked on predictions — it is a status game, not gambling.

**Nearest neighbor (and why it isn't one):** Manifold's *Predictle* is a daily web minigame where players rank five existing markets by their current market probability — it scores you against the *consensus*, instantly, as a funnel into Manifold's trading platform. ORACLE scores you against *reality*, over time, to surface real forecasting skill, as a mobile-native consumer ritual (event drop, streaks, share receipts, push). Its existence validates demand for a casual daily prediction game; no incumbent treats that game as the product itself.

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
4. **Share card:** an image generated in-app for the OS share sheet, framed as a **challenge**, e.g. `🔮 ORACLE #47 — 4/5 · called The Big One with the 22% · can you outsee me?`. The link opens straight into today's round; when the recipient finishes, they get a head-to-head compare against the sender. Receipts culture ("I called it") is the viral engine; the challenge frame sharpens it (the 2025–26 boom in settle-it-with-friends apps shows this vein is hot).

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

## 3b. Visual identity — "digital antiquity"

**Classical mythology annotated by a machine.** Reference pair: Waterhouse's *Consulting the Oracle* (1884) × the Palantir/Quartr school of monospace-text-as-image posters. The ancient ritual (consulting an oracle) executed by a machine — the aesthetic states the concept. Evolved from the earlier "haunted mainframe": terminal DNA retained (mono type, typewriter text, receipts, boot sequence), CRT-green kitsch dropped.

**Two voices, strict roles, never blended on one layer:**
- **Machine voice** (monospace, timestamps, technical annotations) owns all *structure and chrome*: question cards, scoring, stats, daily UI. Terminal-clean on near-black. Paintings never sit behind body text (oil texture under small type is mud; readability beats theme).
- **Temple voice** (public-domain classical art + Trajan-class serif display type) owns *moments*: first boot, Big One reveals, title promotions, share cards, Grand Oracle. Scarcity keeps it sacred.

**Palette:** obsidian black, bone/parchment, gold leaf, one deep accent (oxblood). Serif × mono, black × gold — antiquity × machine stated typographically.

**Type:** **ABC Arizona Flare** (Dinamo) is the display/temple voice — the flare-serif cut: inscriptional, carved-stone antiquity with a modern edge. IBM Plex Mono remains the machine/receipt voice. Licensing: Flare static weights (2, e.g. Regular + Medium) under Dinamo App/Game + Web licenses (one-time, solo tier); trial fonts for mockups only. Optional upgrade if the quote allows: the Arizona variable superfamily unlocks a sans↔serif axis-morph at ritual moments — garnish, not identity; skip without regret.

**Art sourcing:** all-public-domain oracle art (Wikimedia Commons / Met Open Access, hi-res, free). **Title ladder art: Michelangelo's five Sistine sibyls** (Delphic, Cumaean, Erythraean, Persian, Libyan) map one-to-one to Apprentice → Augur → Seer → Oracle → The Prophet.

**Text-as-image:** orb/eye built from repeating micro-text (`THE ORACLE SEES…`) — programmatically generated, unmistakable at thumbnail size; the share-card and marketing motif.

**Guardrails:** mystic-playful voice keeps it warm, not ominous (Berra quote under a sibyl = the wink); it's a consumer game, not defense-tech cosplay. Strategic aim unchanged: instantly distinctive vs. trading-terminal/SaaS incumbents, and squarely at the Design Award's "does the design spark joy."

## 2a. The Oracle's own prophecy — the machine really does tell the future

The aggregate is the prophecy. Skill-weighted crowd aggregates beat nearly every individual in them (Galton → prediction markets → Good Judgment's weighted aggregates beating intelligence analysts in the IARPA tournaments). ORACLE collects exactly the needed ingredients: daily probability judgments plus a per-person skill weight.

- **The Oracle takes a position** on every question: its skill-weighted aggregate (raw crowd at cold start, weights phasing in as Oracle Scores accumulate). Revealed only **after** a player locks in (same anti-herding wall as crowd percentages — if it spoke first, everyone would copy it and the aggregate would eat itself). The result reveal has three characters: you, the crowd, and THE ORACLE FORESAW.
- **The machine is graded publicly.** Its calibration and track record are a first-class screen — and @ORACLE's receipts include its own calls. "The Oracle grows stronger with every consultation" is literally true and is both the mystic arc and a #BuildInPublic storyline.
- **"Beat the Oracle"** is the endgame badge: out-predicting the aggregate over 100+ calls is genuinely elite (the literature says most never will), making it the game's most coveted status.
- **Business closure:** the public, track-record-verified, skill-weighted daily forecast stream is the sellable asset from the talent/data thesis — and eventually a consumer surface of its own (people opening the app to *ask* the Oracle, not just play it).

## 3a. Prizes

- **At launch — status only:** title ladder, **Oracle of the Week** (featured profile + permanent badge), all-time Hall of Fame. Legally inert, and status is on-theme: the whole premise is a status game.
- **Mid-window, if traction — small fixed cash:** "Oracle of the Month wins $500," keyed to **Oracle Score only** (never streaks — see §5a). Monthly horizon, not weekly: a week is ~35 predictions and luck-heavy; a month gives skill room to show, and fewer/bigger prize events are cleaner legally and operationally.
- **Post-traction roadmap — The Grand Oracle (weekly live show, weeks 5+):** live *results* show, not a prediction show — resolution is where the drama lives (predictions can't be resolved live; this is why HQ-style live doesn't map directly). Sunday 8pm ET: the week's Big Ones revealed dramatically, contrarian heroes named, Oracle of the Week crowned live, and one mega-question that locks during the show — the one true moment of simultaneous commitment.

## 3c. Launch & marketing — two tracks

Pure mystery marketing fails without an existing audience (cryptic posts from unknown accounts get zero reach), and Reddit bans stealth promotion. The oracle still arrives as a character — via two parallel tracks:

- **Track 1 — the builder, transparent (#BuildInPublic, #Shipaton tagged):** Erik's own account documents the build — aesthetic coming alive, scoring math, App Review saga, publicly predicting ORACLE's own metrics. Framed as the character's *discoverer*: "I'm building a machine that tells the future." Honest posts in r/SideProject-class subreddits belong to this track. This wins the $30K award and feeds judges the narrative.
- **Track 2 — @ORACLE, in character, mystery + receipts:** terminal-styled posts, never breaks character, always anchored to verifiable predictions. **Starts pre-launch (week 1):** one daily Big One-style X poll (`> QUERY 004 · …`), graded publicly next day (`✅ THE CROWD SAW TRULY · 71% said YES`). Poll voters are the seed crowd; by launch the account has a 3-week public track record. Launch post: `> THE ORACLE WAKES` + store link. Post-launch the app feeds the account: daily crowd stats and anonymized contrarian-hero receipts.

**Boot sequence:** cryptic-numbers CRT boot (date, day number, glyphs) ending in a slow-typed famous quote about the future (Berra, Bohr, Kay, Gibson — short, attributed). Anti-fatigue rule: full cinematic boot on first launch only; daily boot is a ~1s tap-skippable micro-boot (glyph flicker + quote); the long sequence returns only for special moments (50th call, title promotion, Grand Oracle).

## 4. Identity

Play-first: the app is fully playable on first open with device-based identity (anonymous). Creating an account (email magic link / Sign in with Apple / Google) claims the history, enables leaderboard placement, and survives device changes. Device history merges into the account on signup. Sign in with Apple is required by App Review whenever third-party login is offered.

## 5. Monetization — "Oracle Plus" (RevenueCat)

RevenueCat SDK powers all purchases. Free tier keeps the complete daily game; the paywall protects *investment and insight*, never access.

**Oracle Plus subscription (monthly + discounted annual):**
- **Streak Shield** — miss a day, keep your streak. The single most proven daily-game monetizer (Duolingo pattern), with a humane twist: **everyone gets one free auto-shield per month**, delivered in the mystic voice ("the veil was closed to you — the Oracle forgives"); Plus gets more. Duolingo's data shows forgiving streaks *increase* 7-day+ streaks by 40%+, and the free mercy makes the paid shield feel generous rather than extortionate (streak-anxiety resentment is well documented).
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

- **An agent (Hermes) runs the treadmill:** drafts ~10 candidate questions each morning from news/sports/weather feeds **plus the Manifold and Kalshi public APIs** — trending markets are pre-validated question candidates, and their live probabilities are a difficulty gauge (target near-50/50 for The Big One; avoid 90/10 gimmes). **Every candidate includes explicit resolution criteria and a named data source at creation time** — this discipline prevents adjudication fights. The agent also pre-fetches resolution data and drafts @ORACLE posts/receipts.
- **Autonomy bright line:** the agent may auto-resolve only what an API can attest (scores, Kalshi settlements, weather readings); anything requiring judgment gets a human confirm. Question selection starts human-approved (~15 min/day) and graduates to auto-publish once agent picks match the operator's for several consecutive weeks. Source questions *from* Manifold; never resolve *via* Manifold (owner-resolved markets are the trust problem ORACLE positions against). Verify both APIs' commercial-use terms at build time.
- **Manifold code (MIT):** read their `common/` scoring/calibration math as a reference implementation only — ORACLE's scoring is ~200 lines that must be owned and unit-tested, not forked. No other part of their market-maker codebase applies.
- Operator (Erik) approves five per day in a minimal admin web view. Target: under 15 minutes/day. Questions are queued at least 24h ahead so a missed morning never breaks the drop — **the drop must never depend on the agent being alive.**
- **Resolution** is semi-automated: market close, weather, and sports scores fetched from APIs; one-click confirm in admin. Anything ambiguous is **voided** — no points, clearly labeled in-app, never argued.
- Questions must be globally unambiguous (UTC-defined cutoffs, named sources: "per NWS", "per official box score").
- **Trust is UI:** the resolution source prints on every question card (`resolves per NWS, 5pm ET`) and the result receipt shows the actual source data. This inverts the top user complaint about Manifold (arbitrary owner-resolved markets) into a visible brand promise.

## 7. Architecture

> Full dependency choices, versions, monorepo layout, marketing-site tech, CI, and build order: see **`2026-08-19-oracle-tech-spec.md`**.

**Mobile app:** Expo / React Native, TypeScript. One codebase → iOS + Android. EAS Build for store builds; EAS Update (OTA) for rapid iteration during the traction window without waiting on App Review.

**Graphics/motion stack — Reanimated owns motion, Skia owns pixels.** Reanimated 3+ for all UI motion (springs, gestures, transitions, typewriter cadence) on ordinary views — keeps accessibility and layout. `@shopify/react-native-skia` only for what views can't draw: film-grain/aged-paper shader overlay, gold-leaf shimmer shader, the generative text-orb, and **offscreen share-card rendering** (`makeImageSnapshot` — the same components draw the in-app result and the exported PNG). Reanimated values drive Skia uniforms. Discipline: two signature shaders (grain, gold shimmer) reused everywhere — cohesion over effect count; timebox shader work. (EAS dev builds are already required by RevenueCat/OneSignal, so Skia adds no workflow cost.)

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

- **Week 1 (Aug 10–16):** Apple Developer + Play accounts *immediately* (approval latency). Create @ORACLE account and start the daily X-poll + receipt ritual (Track 2 needs its 3-week head start). Expo scaffold, core loop UI (round → predict → lock → crowd reveal), backend schema + endpoints, question pipeline v0 (manual entry acceptable).
- **Week 2 (Aug 17–23):** results/reveal flow, streaks, share cards, RevenueCat + Oracle Plus paywall, OneSignal, PostHog. TestFlight to friends. Store assets (icon, screenshots). **Submit to App Review.**
- **Week 3 (Aug 24–30):** ship v1.0 publicly (target: live by ~Aug 28). Begin daily question ops for real. Begin #BuildInPublic posting — including the meta-move: publicly predicting ORACLE's own metrics in the app.
- **Weeks 4–7 (Sept):** iterate on retention/share loop via OTA updates, leaderboard, Oracle Score reveal at 50 calls, Oracle of the Week, growth experiments, LLM question pipeline. If traction: Oracle of the Month cash prize (after §5a checklist + lawyer hour) and a first Grand Oracle live results show as a #BuildInPublic event. Record 2-min demo video, prep Devpost submission (icon 1024², screenshot 1179×2556, promo code, category descriptions, #BuildInPublic post links). **Submit by ~Sept 27** (buffer before the 30th deadline).

## 11. Testing

- Unit tests for scoring (proper scoring rule, contrarian bonus, streak logic, void handling) — this math must be provably right or the leaderboard is meaningless.
- Integration tests for the submission lifecycle (open → predict → lock → resolve → score) including lock-time rejection and idempotent retries.
- Manual device passes for the paywall (RevenueCat sandbox), push, share sheet, and anonymous → account merge.

## 12. Explicitly out of scope (v1)

User-submitted predictions, comments/social feed, real-money anything, private leagues, native widgets, web app, the talent/data business, localization. All wait until the loop proves it retains.

**Earmarked for a week-4/5 OTA drop (validated demand, cheap build):** **Personal Prophecies** — private free-text predictions with a resolve-by date and a reminder push ("Six months ago you prophesied…"). Serves the demonstrated prediction-journal niche (Foresee/PredictionBook-class apps), creates long-tail re-engagement, feeds share receipts, and slots into Oracle Plus.

## 13. Success criteria

- App live on the App Store during the Shipaton window (hard requirement).
- RevenueCat-powered subscription live with ≥1 real purchase.
- D1 retention > 40%, D7 > 20% among users acquired via share links (the experiment's core hypothesis).
- Devpost submission complete with all assets before Sept 30.
