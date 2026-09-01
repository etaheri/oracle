# ORACLE — End-to-End Gameplay Audit

**Date:** 2026-08-31 (30 days to Shipaton deadline)
**Scope:** the whole game as it plays today on `main` @ `17a1922` — scoring math, backend lifecycle, mobile flow, spec-vs-shipped — judged against the 2026-08-09 design spec and game-theory / daily-game best practice.
**Baseline:** core 63, api 157, mobile 76 tests green; typecheck clean in all three packages.
**Method:** four parallel read-only audits (core, api, mobile, spec-gaps), key claims re-verified by hand against source.

---

## 0. Verdict in one paragraph

The daily loop is real and mostly right: the anti-herding wall holds, locks are server-clock and per-question, seals are idempotent with no edit path, settlement is retry-safe, the truth economy (Oracle Score) is genuinely walled from everything purchasable, and the seal→verdict→throw ritual is the strongest single moment in the game. What's wrong is concentrated in four places: **(1) the daily-points rule is not proper** — the wins-only contrarian ×2 rewards conviction inflation and side-flipping, and the app actively teaches the exploit; **(2) the second dopamine hit has no trigger and is half-built** — nothing calls the player back at noon, and the reveal shows neither streak nor Oracle Score movement; **(3) the viral loop is open-circuit** — the share message has no link; **(4) the game does not exist in production** — no EAS build, no RevenueCat, no OneSignal, pipeline not armed, zero analytics. (1) is a one-constant design decision; (2)–(3) are ~3 days of app work; (4) is gated on Erik's real-world items and is the schedule risk.

---

## 1. Game theory — is the scoring right?

### 1.1 CRITICAL · Daily points are an improper scoring rule (contrarian ×2, wins only)

`packages/core/src/scoring.ts:18-23`, `constants.ts:9`.

```
pts  = round(mult × 200 × (0.25 − brier))
mult = (bigOne ? 2 : 1) × (win && sidePct < 40 ? 2 : 1)
```

Big One ×2 scales wins and losses symmetrically → still proper. Contrarian ×2 scales **wins only** → on a minority side, the expected-points maximizer for true belief `p` is `c* = 2p / (1+p)`, not `p`:

| true belief p | honest E[pts] | optimal report → E[pts] |
|---|---|---|
| .50 | −0.5 | **65** → +8.3 |
| .60 | +2.0 | **75** → +20.0 |
| .70 | +8.0 | **80** → +35.4 |
| .80 | +18.0 | **90** → +54.4 |
| .90 | +32.0 | **95** → +76.1 |

It also flips sides: if you lean YES at ≤ ~0.58 and can guess the crowd leans YES, switching to NO is +EV (breakeven ≈ 0.59). The hidden-crowd wall limits this to "guess the majority side," which is easy on the designed easy question and any newsy one. The per-seal AGAINST THE TIDE gold verdict and `RITES_LINES` teach this behaviour explicitly.

The tech-spec / plan claim "affine Brier — honesty optimal on both scoreboards" is **false for the fun economy**. The truth economy is unaffected (§1.3), so the legal/credibility wall holds — but the fun economy is what players see daily.

**Fix options** (pick one, all are one-line changes):
- (a) **Flat additive contrarian bonus** independent of confidence (e.g. +20, +40 on Big One). Additive constants preserve properness. Keeps the share moment. ← **recommended**
- (b) Symmetric ×2 on contrarian wins *and* losses ("stand against the tide, double stakes"). Proper, but punitive and changes the feel.
- (c) Keep as-is, document as a deliberate fun-economy tilt, retract the properness claim.

### 1.2 MAJOR · Contrarian fires on trivially small crowds

`apps/api/src/resolution.ts:10-11`. `crowdYesPct` includes the player. n=3 with you alone on a side → 33% → ×2, gold "AGAINST THE TIDE", TIDE-FIGHTER epithet. At launch crowd sizes this fires constantly and meaninglessly; and with unlimited device minting (§2.2) 15 burners can push any question under 40%. **Fix:** contrarian multiplier + `crowdVerdict` + `tideWins` require `player_count ≥ 20` (else treat sidePct as 50); mobile footer prints "THE CROWD IS STILL GATHERING" below N=5.

### 1.3 ✅ Truth economy is correctly walled

`oracleScore` sees raw Briers only — no Big One weight, no contrarian, no first-hour, no streak; voids excluded; last-100 window; null under 50 calls; complete rounds only, enforced at settle and at recompute. This is the part that must be right and it is.

### 1.4 ✅ The 55 floor is sound

A true-50 player forced to 55 loses 0.5 expected pts/question and 0.0025 Brier/call (−2.5 Oracle Score if *every* call were a coin flip). Nearly costless; 55 *is* the abstain. Erik's floor ruling stands. The only real distortion at p=.50 is §1.1 (flip to the minority side at 65 for +8), not the floor.

### 1.5 Calibration copy issues (voice spec "never blunt without receipts")

- **MAJOR** `epithet.ts:52-58` `calibrationVerdict` has no minimum n — fires after one call. At 25 calls sd(accuracy) ≈ 9pp, so a perfectly calibrated player reads "YOUR CONFIDENCE OUTRUNS YOUR ACCURACY" ~15–20% of weeks. Fix: null below ~20 resolved calls; band on |gap| > 1.5·sd rather than fixed ±10.
- **MINOR** `epithet.ts:32-33` HIGH PRIEST OF CONVICTION (avgConf ≥85 & acc ≥60 → "THE LEDGER AGREES") crowns a +30 gap — the worst-calibrated profile in the ladder. Add `gap ≤ 10`.
- **MINOR** `epithet.ts:26` TIDE-FIGHTER "{n} TIMES AGAINST THE CROWD. {n} TIMES RIGHT." — attempts aren't tracked; a 3-for-11 player is told 3-for-3. Reword or count attempts.

### 1.6 Other scoring/streak edges

- **MINOR** Free monthly shield auto-burns on a 1-day streak (`streak.ts:25-27`). Shield only when `streakCurrent ≥ 3`.
- **MINOR** "Complete round" defined three ways: `=== qs.length` (settlement:49), `=== 5` (settlement:89), `>= 5` (me.ts:57). Unify on the round's question count.
- **MINOR** First-hour +10% requires **every** sealed prediction early (`round.ts:95`); 4 early + 1 at 1:05 loses the whole bonus, rites line doesn't say so. Either pro-rate or say "all five."
- **MINOR** Month boundary: settle keys free shield on `month(roundDate)`; ledger uses device `new Date()` UTC month (`me.ts:79-82`) — off by one around the 1st.
- **NOTE** Oracle Score scale is compressed: always-55 coin flip = 747, good forecaster ≈ 820. Realistic spread 740–850 on a "0–1000" dial won't feel like progress. Consider a display transform (skill score vs 0.25 baseline) when the leaderboard arrives.
- **NOTE** Daily points have no accumulator — the fun economy scores a day and forgets it; streak is the only persistent fun progression.

---

## 2. Backend integrity & lifecycle

### 2.1 CRITICAL · No correction path after resolution; admin resolve has no status guard

`apps/api/src/resolution.ts:5-22`, `routes/admin.ts:32-37`. `resolveQuestion` overwrites outcome/points/brier on any status. After `settleRound` flips the round to `resolved`, a corrected outcome rewrites predictions but `users.callsResolved` / `oracleScore` are never recomputed → the truth economy silently drifts from the receipts. The Telegram report says "reply if any outcome looks wrong" but nothing can act on it. **Fix:** guard `status ∈ {locked}` (or explicit `force`), and a re-settle path that recomputes affected users from `completeRoundBriers`.

### 2.2 CRITICAL · Device minting is unlimited and unauthenticated

`routes/auth.ts:11-25`. Every `POST /v1/auth/device` mints a user. Consequences: contrarian manipulation (§1.2), inflatable `player_count` on home, zero-cost "burner peeks crowd, relays to main." **Fix:** Cloudflare rate-limit rule on the path (one config line) + the ≥20 crowd floor.

### 2.3 CRITICAL · The drop depends on the agent being alive

`pipeline/state.ts:78,95-98`. Tomorrow is authored at 17:00 ET (~19h buffer; spec asks ≥24h). If authoring fails 17:00–23:00 you get a Telegram at 23:00 and must hand-author; if nothing happens, noon has no round → THE ORACLE SLEEPS and **every player's streak lapses at the next settle**. Spec §6: "the drop must never depend on the agent being alive." **Fix:** a bank of ≥2 pre-approved evergreen drafts; 12:00 publish falls through to the oldest bank draft when today has none.

### 2.4 MAJOR · Lifecycle is entirely cron-gated; `/today` never self-locks

`worker.ts:23-24`, `round.ts:8-9`. With `PIPELINE_ENABLED` off (current prod state) rounds never lock/resolve/settle; `/today` keeps serving the stale round (`findFirst` on `status=open`, no `orderBy`, no `locksAt` check — memory already notes 08-28 served on 08-31). Even enabled, `*/10` means up to 10 min where the app shows an open round that 409s every seal. **Fix:** `/today` treats `now ≥ locksAt` as not-open independent of cron; `orderBy date asc`.

### 2.5 MAJOR · Autonomy bright line is inverted

Spec §6: auto-resolve only API-attestable outcomes; judgment gets a human confirm; selection starts human-approved. Built: publish is automatic at noon with no `/hold`; resolution is a Sonnet web-search verdict; settlement pays out immediately. Combined with §2.1 there is no human anywhere from draft→payout except optional `/reroll`. **Fix (cheap):** `/hold <slot>` blocks publish; 30-min settle delay with `/flip <slot>` before points are paid.

### 2.6 MAJOR · 13:00 ET hard void is aggressive

`state.ts:83-89`. Anything unresolved 60 min after lock is voided. Spec §8: "late but never wrong." A rate-limited source silently zeroes a slot — a voided Big One wipes the day's headline. **Fix:** auto-void only after ~24h; before that, alert + human decision. Track void rate as a health metric — it is the fastest way to make rewards feel arbitrary.

### 2.7 MAJOR · Per-question early locks not authored

`pipeline/draft.ts:63-65`. Submission already enforces per-question `locksAt`; authoring sets all five to noon D+1. A 7pm tip-off question is answerable at 11pm with the score known. **Fix:** `locks_at` in `DraftQuestionSchema` + per-question `locks_at` in `/today`.

### 2.8 Other backend

- **MAJOR** Oracle's own forecast (`forecast.ts`, tested) is never called — no `oracle_forecasts` table, no `THE ORACLE FORESAW` on reveal. Cheap now: store raw crowd mean at lock (the cold-start rule) so the machine has a graded track record from day one.
- **MAJOR** Entitlements are write-never; paid-shield branch in settlement is dead in prod.
- **MAJOR** Identity is device-only, no merge, no expiry; reinstall = new user; streak and Oracle Score die with the phone.
- **MINOR** `settleRound` O(users × queries), `composeHingePushes` loads all users — fine at launch, hits Workers CPU limits at a few thousand.
- **MINOR** `idempotency_key` validated and ignored (unique index does the job); `rounds.player_count` dead column; missing indexes `predictions(user_id, created_at)`, `questions(round_date)`, `users(oracle_score)`.
- **OPS** No migrate workflow (0001/0002 applied by hand); no prod secrets set.

---

## 3. Mobile — does the game make sense to a player?

### 3.1 CRITICAL · Partial rounds are silently un-rated

`round.tsx:105-124`, `copy.ts:126-137`. Spec §3's most important rule — answer all five or the day doesn't feed Oracle Score — is never told. Seal I–III and leave: no exit warning, home just says ENTER again, no "III OF V SEALED," and the closing reminder says "FIVE ANSWERS STAND BETWEEN YOU AND NOON" (wrong for a 3/5 player). **Fix:** home state for `anySealed && !allSealed`; 11th rites line; partial-aware reminder.

### 3.2 CRITICAL · Reveal shows no streak update and no Oracle Score movement

`reveal/[date].tsx:108-186`, `RevealSchema`. Spec §2 step 3 lists "points, streak update, Oracle Score movement." The player never sees "VIGIL: DAY 4" land as a consequence of playing. Oracle Score is `UNWRITTEN` until 50 calls with **no progress counter** — the spec's own named retention mechanic is a null state. **Fix:** `streak`, `streak_delta`, `calls_rated`, `calls_to_rank` on the reveal (or fetch ledger alongside); two lines under DAY POINTS; "37 OF 50 CALLS WRITTEN" on plaque and home.

### 3.3 CRITICAL · "Trust is UI" is absent

`OracleCard.tsx:278` prints `PER ESPN` at 8.5pt; `resolution_criteria` is fetched and never rendered. Reveal rows show text + points only; `RevealSchema` has no source, evidence, or void reason though the DB stores `resolutionEvidence` and `sourceUrl`. A void is a bare `∅` and `—`. This is the brand promise the spec builds against Manifold. **Fix:** criteria on the card (tap-to-expand or ≤11pt line); per-row `PER {source}` + evidence quote + void reason on the reveal.

### 3.4 MAJOR findings

- **Locked-round dead end** — on 409 the card returns with "THE ORACLE HAS CLOSED" but stays pullable; `useToday` not invalidated. Invalidate + render closed state.
- **No pre-drop lobby; SLEEPS hole at the drop** — between lock and publish `/today` 404s → "THE ORACLE SLEEPS" at 12:00 ET, the one moment the spec wants an event. API returns next `opens_at`; home shows "THE ORACLE SPEAKS IN MM:SS."
- **Lapsed player learns nothing** — `revealReady` requires `my !== null`; the quiet "Yesterday's ledger" shows all `·`/`—`, share hidden; `streak.lapse-*` and `noon.lapsed-*` copy exist in the bank and are never rendered. Show outcome + crowd for spectator rows.
- **Two gold CTAs at noon** — READ THE LEDGER and ENTER stacked; spec says results first. Auto-route to reveal; its bottom CTA enters today's round.
- **Post-seal finale has no forward action and no share** — after card V: "The ledger is read tomorrow at noon." and nothing to press. Spec wants the challenge share *at lock*. Add sealed-variant share + RETURN AT NOON.
- **Big One downside invisible at the pull** — "worth double" on the eyebrow; with `LEAN_FULL=0.62`, 95% is one thumb stroke on the card where a wrong 95% costs −262. Eyebrow "PAYS DOUBLE · COSTS DOUBLE"; warning tone at 90/95 on the Big One.
- **Honesty-is-optimal asserted, never shown** — nothing exposes that wrong@95 (−131) costs 13× wrong@55 (−11). One `questionPoints` call: "+49 IF RIGHT · −131 IF WRONG" under the reading. The single most game-theory-literate thing the UI could do.
- **No reveal-time reminder; bare OS permission prompt** — only the 3h-before-lock local notification; nothing at noon for the ledger; no interstitial (voice spec §4). Add a local noon "THE LEDGER IS READ" (generic line, voice-legal) now; interstitial before `requestPermissionsAsync`.
- **Buttons-mode has no conviction teaching** — hold = conviction is only in the a11y hint string; sighted reduced-motion players get nothing. Show "HOLD TO RAISE CONVICTION · RELEASE TO SEAL."
- **"NOON TO NOON" never says which noon** — a West-coast player sees a 9am lock unexplained. "NOON, NEW YORK" once.

### 3.5 Minor

- Countdown "THE LEDGER IS READ IN" hits 0:00:00 → "RETURN AT NOON" — it *is* noon. Swap to "RETURNING SHORTLY" when `now ≥ locks_at`.
- Share message has **no link** (`sharePattern.ts`); `oracle://` scheme exists, nothing composes a URL.
- `markRevealSeen` fires on data load, before the ceremony plays.
- Three nouns for one number: ORACLES WAITING / CONSULTED / HAVE SPOKEN; "waiting" is wrong (they've sealed).
- `LEAN_COMMIT=0.12` — a ~40px brush seals a real prophecy; no undo window. Consider 150ms tap-back grace or a higher commit fraction on card I.
- Plaque never says epithets are 28-day rolling; "THE UNREAD" on day 2 has no "5 complete days unlock your epithet."
- `yesterdayOf` uses device clock when no round is open — off by one around midnight UTC.
- Round-screen sleeps state is serif with no countdown; home's is mono — two voices for one state.

### 3.6 ✅ What's solid on mobile

Anti-herding wall (crowd fetched only for sealed questions, undealt cards symbol-only static); `crowdVerdict` thresholds exactly mirror `CONTRARIAN_CROWD_PCT`; optimistic seal with server-authoritative rollback and hydration on relaunch; the floor rite fires at the exact moment the floor is met; reveal ceremony sequencing; rites reachable forever; flags re-read on focus.

---

## 4. Spec vs shipped — the matrix

Note: `2026-08-28-close-the-loop.md` has every checkbox unticked but all 7 tasks shipped (`ab6e0ba`, `6bb8744`, `89961cd`, `313d9c5`, `6ded929`, `a46d725`, `982ec9b`). The doc is stale, not the code.

| Feature | Status | Load-bearing for |
|---|---|---|
| Daily Five, noon-to-noon, server lock, per-question 409 | SHIPPED | — |
| Yes/no + 55–95 confidence (swipe) | SHIPPED | — |
| Crowd hidden until commit | SHIPPED (per-question, deliberate deviation) | — |
| Drifting crowd post-seal | SHIPPED (10s poll, no DO) | — |
| Live player counter | PARTIAL (live query; no lobby) | minor |
| Pre-drop lobby / 11:45 summons | MISSING | low |
| First-hour bonus, Big One ×2, contrarian | SHIPPED (contrarian improper, §1.1) | — |
| Void handling | PARTIAL (no reason, no source) | loop clarity |
| Resolution source / criteria on card & reveal | PARTIAL / MISSING | brand promise |
| Streaks, free shield, retry-safe settle | SHIPPED | — |
| Paid shields | STUBBED (no writer) | **Shipaton** |
| Oracle Score, 50-call gate, complete-rounds | SHIPPED | — |
| 50-call progress / unlock ceremony | MISSING | retention, cheap |
| Title ladder, percentile | MISSING (epithets are a different system) | low for window |
| Leaderboards, Oracle of the Week | MISSING | needs identity |
| Share card image | SHIPPED | — |
| Challenge link → today's round | MISSING (no URL, no domain, no landing) | **virality — critical** |
| Head-to-head vs sender | MISSING | virality high |
| Sign in with Apple / merge | MISSING (not App-Review-blocking since no third-party login is offered) | retention/sybil |
| Oracle Plus paywall (RevenueCat) | MISSING | **hard requirement** |
| Plus content (deep stats / archive / cosmetics) | MISSING | need ≥1 sellable thing |
| One-time shield rescue IAP | MISSING (no at-risk moment surfaced) | HAMM; retention |
| Push: summons + results-ready (OneSignal) | STUBBED (compose + no-op sender; local closing call only) | **OneSignal award**; hit #2 |
| Notification permission interstitial | MISSING | opt-in rate |
| The Oracle's own prophecy | STUBBED (`forecast.ts` unused) | brand arc |
| Market prob on reveal | SHIPPED | — |
| Hermes authoring + verify-or-void | SHIPPED, **not armed in prod** | **the treadmill isn't running** |
| Admin | API + Telegram only (acceptable) | — |
| PostHog | MISSING — **D7 gate is unmeasurable** | the experiment |
| Sentry | MISSING | nice |
| EAS build / dev client / TestFlight | MISSING (Expo Go only) | **hard requirement** |
| Migration workflow | MISSING | ops |
| Personal Prophecies, Pools, user questions | MISSING (cut) | — |

---

## 5. Retention-design read

1. **Two-hit day is half-delivered.** Hit #1 (seal → verdict) is excellent and pays five times. Hit #2 (results) has no trigger — no push at noon, home CTA only if they happen to open. Cheapest fix: local noon notification from the same reseal that schedules closing calls.
2. **Streak is invisible on the day it matters.** No "your vigil of N days ends at noon," no lapsed-yesterday line, no rescue moment — which is also the one-time IAP's only point of sale.
3. **Mid-term goal is missing.** Daily loop strong, long-term identity (plaque/epithet) good, but 50 calls → Score → title is a null state. One progress line turns the first 10 days into a countdown.
4. **Social proof exists only pre-seal.** For a 4-week window with device identity, leaderboards are the wrong spend (sybil-trivial). Share → head-to-head compare needs only a token in the link.
5. **Viral loop is open-circuit.** No link in the share; sender never learns anyone played.
6. **Variable reward is well-tuned.** Keep. Suppress verdict below N=5.
7. **Appointment is honest but unexplained** (which noon).
8. **Void UX undermines the trust promise.**

---

## 6. Priority order — Sept 1 → Sept 27

**Tier 0 — hard gates, blocked on Erik, start today:**
- Apple Developer enrollment → `eas.json` + dev client → TestFlight.
- Domain (universal links + share landing).
- Production Worker: secrets ×6, migrations 0000–0002 on prod Neon, `PIPELINE_ENABLED`, seed 3 days, verify one full noon tick. **The game does not exist in production yet.**

**Tier 1 — must ship (~2 weeks):**
1. **Scoring fix (§1.1)** — one constant + one line; do it before any real player has a history. Add the ≥20 crowd floor (§1.2). Half a day incl. tests and copy.
2. **Integrity trio (§2.1, 2.2, 2.4)** — resolve status guard + re-settle, mint rate-limit, `/today` self-lock. 1 day.
3. RevenueCat: products, `react-native-purchases`, paywall, webhook → `entitlements`. Sellable: paid shields (settlement already consumes them) + archive (`/reveal/:date` already works; gate > yesterday behind Plus) + plaque cosmetic. 3–4 days.
4. Streak-at-risk line + rescue moment on home (½ day) — the IAP's point of sale.
5. OneSignal + wire `composeHingePushes` into settle with the 4 obligations + interstitial. 2–3 days. **Regardless: local noon "ledger is read" notification today** (2 hours).
6. Reveal completeness (§3.2, 3.3): streak/score lines, 50-call progress, source + evidence + void reason. 1–1.5 days.
7. Share link: App Store URL in message (S) → `/q/:date` landing + OG image (2 days) → head-to-head compare (2 days). At least the first two.
8. PostHog: 7 events + one dashboard. 1 day. Without it the mid-Sept gate is a guess.
9. Small copy/UX batch: partial-round state (§3.1), "NOON, NEW YORK", Big One cost line, payoff line under reading, locked-round dead end, CTA ordering at noon, buttons-mode hint. ~1 day total.
10. Store assets, privacy manifest, **App Review submission by ~Sept 15** to leave a rejection cycle.

**Tier 2 — if Tier 1 lands by ~Sept 17:** Sentry; THE ORACLE FORESAW (store crowd mean at lock + one reveal line); evergreen draft bank + `/hold` + settle delay (§2.3, 2.5); per-question `locks_at` authoring; device-scoped weekly leaderboard by day points; epithet/verdict n-guards (§1.5); 24h void policy (§2.6).

**Tier 3 — cut for the window:** pre-drop lobby, DO/SSE counter, title ladder + sibyl art, Oracle of the Week, admin web UI, Sign in with Apple (unless offering third-party login), Personal Prophecies, Pools, user-proposed questions, Kalshi, Grand Oracle, cash prizes.

**Schedule risk:** Tiers 0–1 ≈ 12–15 working days against ~19 left, *after* Apple enrollment clears. Items that can proceed in Expo Go before the dev build exists: 1, 2, 4, 6, 7 (web half), 8, 9. Start those now.

---

## 7. What is genuinely well done (don't touch)

- Truth-economy wall; `oracleForecast` (Satopää-style weighted + extremized) ready in core.
- Server-clock per-question lock, unique index idempotency, no edit after seal, final-crowd-at-resolution (late players can't be gamed by early ones).
- Anti-herding wall end to end (`/today` no side counts; `/today/crowd` sealed-only, tested; `/mine` caller-only).
- Retry-safe settlement with player-favourable write ordering.
- Pure, replayable pipeline decision core; DST-proof noon; race guards both sides; one-question-fails-never-stalls-the-round.
- Authoring contract (5 slots, Big One at 5, ≥4 categories, author_probability 0.30–0.70, criteria + source required, 7-day dedupe).
- The seal ritual, per-seal verdict as variable reward, floor rite timing, reveal ceremony staging, copy lint as the voice's guardian.
