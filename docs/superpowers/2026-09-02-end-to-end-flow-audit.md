# ORACLE — End-to-End Flow Audit

**Date:** 2026-09-02 (28 days to Shipaton deadline)
**Scope:** the whole app as it stands on `main` @ `9ade86d` — the new player's first ten minutes, the returning player's day, gameplay comprehension, monetization honesty, and what stands between here and the App Store.
**Baseline:** typecheck clean in all three packages; 596 tests green (core 82, mobile 249, api 265).
**Status:** everything in §9 that does not need a credential Erik has yet to create was applied in the same session and is marked FIXED below — 619 tests green after. What remains is listed at the end of §9.
**Relationship to prior audits:** `2026-08-31-gameplay-audit.md` and `2026-09-01-window-seeding-story-audit.md` are largely **executed** — the contrarian bonus is additive, the crowd floor exists, `/today` self-locks, `resolves_at` is required and the lock is derived in code, the author gets outcome feedback, receipts print on the reveal, RevenueCat ships, the evergreen bank exists. This document does not re-litigate those. It reads the app as a player meets it, and it goes at what is still wrong.

---

## 0. Verdict in one paragraph

The craft here is unusually high and the daily loop is genuinely good — the pull-and-throw seal is the best interaction I have seen in a daily game, the anti-herding wall holds end to end, the scoring rule is proper, and the layout-stability and reduced-motion work is better than most shipped consumer apps. What is wrong is not craft, it is **legibility and closure**. Three things: **(1) the game never tells the player what it is for** — the Oracle Score is the whole premise and the point of the ledger, and no screen in the app defines it, explains what "rates" means, or says what 50 is 50 *of*; **(2) the crowd, the app's best character, breaks at launch scale** — the finale prints "100% SAY YES" for a crowd of one, and the round footer promises AGAINST THE TIDE at crowd sizes where the bounty provably will not pay, distinguished only by colour, which this project's own brief forbids; **(3) the second dopamine hit still has no reliable trigger** — the server-side push is written, tested, and called by nothing, and its external-id targeting would not match the client's even if it were wired. Beyond those, one paid purchase is sold at a streak length where the thing it buys cannot fire, and two placeholder strings still stand between the repo and App Review.

---

## 1. The new player's first ten minutes

### 1.1 CRITICAL · The app never says what it is for — **FIXED 2026-09-02**

This is the largest single problem in the product, and it is copy, not code.

The premise is a search for people who can tell the future. The mechanic that resolves it is the **Oracle Score**. Here is every place a player can encounter it:

- `ledger.tsx:161` — a plaque row reading `ORACLE SCORE   UNWRITTEN · 0 OF 50`.
- `revealRows.ts:69` — one reveal line reading `0 OF 50 CALLS WRITTEN`.

That is all. Nothing anywhere states that the Oracle Score is a calibration-based skill rating, that it is the point of the game, that it is the one number nothing purchasable can touch, or **what 50 is 50 of**. A new player reads "UNWRITTEN · 0 OF 50" as a progress bar toward an unnamed thing.

It compounds in the rites. `RITES_LINES` X reads:

> SEAL ALL FIVE OR THE DAY DOES NOT RATE. POINTS AND VIGIL STILL COUNT.

**"Rate" has no antecedent anywhere in the app.** The same verb appears in `PARTIAL_LINE` on home ("THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED") and in the closing push copy. A player is being told, three times a day, that something they cannot name will not happen.

The rites have the same gap for two other nouns: **"vigil"** appears in rules X and XI and in the plaque with no definition, and **"bounty"** (rule VIII) names an amount nobody knows and a crowd floor nobody is told about.

**Fix (cheap, high value):** two or three lines. A rite that names the goal before the rules that serve it — *"THE LEDGER RATES YOUR CALLS AGAINST WHAT HAPPENED. FIFTY RATED CALLS WRITE YOUR ORACLE SCORE."* — and a one-line gloss under the plaque's score row. The machinery is all built; the game is simply not explaining itself.

### 1.2 MAJOR · Twelve rules is the wrong shape for a 90-second game — **FIXED 2026-09-02**

`rites.tsx` is a hard gate on the first ENTER (`index.tsx:212` routes first-timers to `/rites`, whose BEGIN does `router.replace("/round")`). Twelve tracked all-caps mono rules at 11pt, printing on a 130ms stagger, is roughly 150 words of dense machine voice standing between install and first card.

Several of them are edge rules a player does not need before card I: VIII (contrarian bounty), IX (first hour), XI (shield). Those are discoverable at the moment they matter — the app already does exactly this well elsewhere with the one-time floor rite ("NO COIN FLIPS · 55 IS THE LEAST BELIEF", `round.tsx:157`), which is the right pattern.

**Fix:** split the rites. Four or five rules before the first card (what a round is, how to pull, that a seal is final, that the crowd is hidden, that all five rate the day). The remaining seven stay on the standing `[THE RITES]` link, where they already live forever.

### 1.3 MAJOR · The Calling is 13.6 seconds with no visible skip — **FIXED 2026-09-02**

`CallingRite.tsx`: 5 beats × `BEAT_MS 2400` + `FINAL_HOLD_MS 2000` + `FADE_MS 600` ≈ **13.6 s** before the app is usable, on the very first open. It is tap-anywhere skippable and the `accessibilityLabel` says "Skip introduction" — but **nothing visible says so**. A judge or a first-time installer sees a screen that does not respond to anything for fourteen seconds.

The writing is excellent and worth keeping. It needs a visible affordance — the reduced-motion branch already renders a `CONTINUE` link; the cinematic branch should show a dim `TAP TO SKIP` after the first beat.

### 1.4 MAJOR · The push permission ask interrupts the crowd reveal — **FIXED 2026-09-02**

`round.tsx:88-91`:

```ts
useEffect(() => {
  if (allSealed && !summoned.current) { summoned.current = true; void maybeSummon(...); }
}, [allSealed]);
```

`allSealed` flips in the same commit that swaps the live card for `<CrowdReveal>`. The effect runs after paint, so the player seals card V, the crowd finale renders for one frame, and `/summons` is pushed over the top of it.

**The crowd reveal is dopamine hit #1's payoff — the whole reason the anti-herding wall exists — and the app covers it with a permissions interstitial.**

`index.tsx:105` already fires `maybeSummon` on any focus after a first seal, so the round-screen trigger is redundant: deleting it moves the ask to *after* the player returns home, which is the correct beat. (Keeping a round-screen trigger is fine too, but it belongs on CrowdReveal's RETURN AT NOON, not on the fifth seal.)

### 1.5 MINOR · A brand-new player's footer offers two dead rails

`[YOUR LEDGER]` on install day shows THE UNREAD with `0 OF 5 COMPLETE DAYS WRITTEN` and `UNWRITTEN · 0 OF 50` — an honest but entirely empty plaque. `[YESTERDAY]` shows a round they could not have played, with the lapsed line "THE LEDGER WAS READ WITHOUT YOU. TOMORROW IT NEED NOT BE." — which reads as an accusation for someone who installed an hour ago.

Cheap: suppress the lapsed line when `days_consulted === 0`, and give the empty plaque one forward-looking line instead of a blank record.

---

## 2. The crowd — the app's best character, broken at launch scale

### 2.1 CRITICAL · The finale prints a crowd of one as a percentage — **FIXED 2026-09-02**

`CrowdReveal.tsx:88-90` renders `{c.crowd_yes_pct}% SAY YES` and a `CrowdBar` **with no crowd-size floor at all**, directly above a footer that says `1 ORACLE HAS SPOKEN`.

At launch crowd sizes this is what most players will see on their first ever finale:

```
[############]  100% SAY YES        YOU: YES @ 75%
                1 ORACLE HAS SPOKEN
```

The percentage *is* the player. This is the screen the whole anti-herding wall was built to protect, and on day one it reads as a bug.

`crowdVerdict` already solved this for the round footer — `VERDICT_MIN_PLAYERS = 5` → "THE CROWD IS STILL GATHERING". **The finale never got the same guard.** Apply it: below 5, print the gathering line instead of a bar and a number.

### 2.2 MAJOR · "AGAINST THE TIDE" is promised where the bounty cannot pay, and only colour says otherwise — **FIXED 2026-09-02**

`crowdVerdict.ts` names the tide from `VERDICT_MIN_PLAYERS = 5` but sets `against` (the gold) from `contrarianApplies`, which needs `CONTRARIAN_MIN_CROWD = 20`. The tests assert this split deliberately:

```
it("names the tide from five players but promises the bounty only from twenty")
```

The intent is right. The execution puts the entire distinction on colour: at N = 5–19 the footer prints `30% SAY YES · AGAINST THE TIDE` in muted ink; at N ≥ 20 it prints the identical string in gold. `reveal/[date].tsx:271` carries the project's own rule in a comment — *"outcome must never be carried by colour alone (brief §11)"* — and this violates it.

The consequences are concrete and will hit every player for the first weeks:
- Round footer: `AGAINST THE TIDE` (muted).
- Same question, thirty seconds later on the finale: **nothing** — `CrowdReveal` gates its "· AGAINST THE TIDE" on `contrarianApplies`, correctly.
- Next day's reveal: no bounty, no explanation.

**Fix:** below the bounty floor, say what is true — `30% SAY YES · FEW STAND WHERE YOU STAND` or `· THE TIDE IS NOT YET COUNTED`. Reserve the exact phrase "AGAINST THE TIDE" for when it pays, since that phrase is also the plaque stat, the epithet, and the reveal's gold moment.

### 2.3 MINOR · Hardcoded thresholds drift from the constants

`crowdVerdict.ts` hardcodes `40`; `reveal/[date].tsx:305` hardcodes `+40`; `revealRows.ts:69` hardcodes `50`. All three have a constant (`CONTRARIAN_CROWD_PCT`, `CONTRARIAN_BONUS × BIG_ONE_MULT`, `ORACLE_SCORE_MIN_CALLS`) and `scoreProgress.ts` already does it correctly. Tuning any of them during TestFlight silently desyncs the UI from the engine.

---

## 3. The reveal — thin where it matters most

### 3.1 MAJOR · The ledger does not record what you actually said — **FIXED 2026-09-02**

For slots I–IV the reveal renders exactly: numeral, question text, `PER {SOURCE}` receipt, and `✓ +49`.

It does **not** show your answer, your conviction, or the crowd split — even though `crowd_yes_pct` and `my.{answer,confidence}` are both in the payload and both rendered for the Big One a hundred lines below.

So a day later, the app that promises **"NOTHING IS REVISED. NOTHING IS FORGOTTEN."** cannot tell you whether you said YES or NO on four of the day's five questions. A player who lost points on III has no way to see what they got wrong. This is the single cheapest large improvement on the screen: the data is already there, and the Big One's own row (`YOU: YES @ 75%` / `CROWD SAID 62% YES`) is the template.

### 3.2 MAJOR · Day points are shown before they are final, then change — **FIXED 2026-09-02**

The ceremony effect correctly refuses to run while any row is unresolved (`reveal/[date].tsx:96`), but the render does not:

```tsx
{!allSpectator && <RollingPoints value={d.day_points} delayMs={POINTS_DELAY} />}
```

`day_points` sums `p.points ?? 0`, so during the resolution window — which `decideActions` retries **hourly, up to noon D+2** — the player sees a real, wrong, lower number under the eyebrow "the ledger is still being read", and it silently increases on refresh.

Home routes them there: `revealReady` returns true as soon as **one** row resolves, so the gold `[READ THE LEDGER]` CTA fires mid-resolution by design.

For an app whose liturgy is "nothing is revised", showing a provisional score is the wrong trade. Either withhold the number until every row has an outcome (print the count instead: `III OF V READ`), or label it as partial.

### 3.3 MINOR · Big One entrance is a scroll position, not a moment

Unchanged from the 2026-09-01 audit §4.1 and still true: the reveal spends 1.1 s of stagger and then becomes a list you scroll. The `TURN THE LAST CARD` idea remains the cheapest way to give hit #2 a fraction of hit #1's grammar, and it reuses a gesture vocabulary the player learned twenty minutes earlier.

---

## 4. Monetization — one honest paywall, one dishonest sale

### 4.1 CRITICAL · The rescue is sold at a streak where the shield cannot fire — **FIXED 2026-09-02**

`index.tsx:124` gates the rescue offer on `notice === risk`. `homeLines.riskLine` fires at **streak ≥ 2**:

```ts
if (streak < 2 || anySealed || msUntilLock === null || msUntilLock > RISK_MS) return null;
```

`streak.ts` refuses to spend any shield below **streak 3**:

```ts
if (state.streakCurrent < C.SHIELD_MIN_STREAK) {
  return { ...state, streakCurrent: 0, usedFreeShield: false, usedPaidShield: false };
}
```

So a player on a 2-day vigil, three hours before lock, is shown:

> YOUR VIGIL ENDS AT NOON. ONE SHIELD WOULD HOLD IT.
> [ RAISE THE SHIELD ]

…and sold a consumable that will not be consumed. Their streak resets anyway and the shield sits in reserve. **This is a real-money purchase whose on-screen promise is false**, and it is the app's highest-intent sale moment. It is also the kind of thing App Review and a refund thread both notice.

**Fix:** one character — gate the risk line (or at minimum `showRescue`) on `streak >= CONSTANTS.SHIELD_MIN_STREAK`. While there, `RITES_LINES` XI and the paywall creed should say the floor out loud: *"A SHIELD DEFENDS A VIGIL OF THREE DAYS OR MORE."*

### 4.2 MAJOR · The purchased shield exists only if a webhook lands — **FIXED 2026-09-02**

`purchaseRescue()` returns true the moment StoreKit succeeds; the entitlement is granted **only** by `POST /v1/webhooks/revenuecat`. There is no client-side reconciliation and no server-side verification path. If `REVENUECAT_WEBHOOK_SECRET` is unset the endpoint 401s every event and **every purchase in the app silently grants nothing** — and that secret is not in `wrangler.jsonc`'s documented secret list (see §6.3).

Home papers over it: on success it prints "THE SHIELD HELD…" and invalidates the ledger query, which will very likely still read `paid_shields: 0` because the webhook has not arrived. The player is told they are protected before anything protects them.

Minimum: verify the ledger actually reflects the grant before printing the confirmation, and fall back to a "the ledger will record it shortly" line.

### 4.3 MAJOR · Striking the record leaves the native SDKs logged in as a deleted device — **FIXED 2026-09-02**

`strikeRecord()` deletes the server rows and clears the device token. It does not touch RevenueCat or OneSignal.

- `purchases.ts` keeps `configured = true`, so `initPurchases()` returns early and never re-configures with the new device id. Every subsequent purchase is attributed to a `deviceId` whose row no longer exists → the webhook's `devices.findFirst` returns null → `ignored: "unknown app_user_id"` → **entitlement permanently lost**, until the app is force-quit.
- `onesignal.ts` keeps `ready = true` and stays logged in under the old external id.
- `usePlusStore.plusActive` keeps its pre-strike value.

**Fix:** `Purchases.logOut()` + reset `configured`, `OneSignal.logout()` + reset `ready`, and `queryClient.clear()` in `confirmStrike`.

### 4.4 ✅ The paywall itself is honest

Prices from the store, restore link, auto-renew disclosure, "THE FREE GAME IS NEVER GATED", no betting vocabulary anywhere, and the truth economy is genuinely walled from everything purchasable (`oracleScore` sees raw Briers only). That part is right and should not be touched.

---

## 5. Notifications — the second hit has no trigger

### 5.1 CRITICAL · Server push is written, tested, and called by nothing — **FIXED 2026-09-02**

`push/compose.ts` and `push/onesignal.ts` are complete and covered by `compose.test.ts`. Nothing in `src/` imports them:

```
$ grep -rn "composeHingePushes\|sendPushes" apps/api/src | grep -v src/push/
(no matches)
```

`settle()` (`actions.ts:170`) narrates to Telegram and stops. `ONESIGNAL_APP_ID` / `ONESIGNAL_API_KEY` are not even declared in `WorkerEnv`.

So the results-ready push — dopamine hit #2's trigger, the design spec's second of two hits, and the entire premise of the OneSignal "Keep Them Coming Back" award — **does not fire**.

### 5.2 CRITICAL · The external ids would not match even if it were wired — **FIXED 2026-09-02**

Client (`notifications/onesignal.ts:34`):
```ts
OneSignal.login(deviceId); // external id = device id (spec §5)
```
Server (`push/onesignal.ts:19`):
```ts
include_aliases: { external_id: [p.userId] },
```

`composeHingePushes` returns `userId` (the `users` row). The client registers `deviceId` (the `devices` row). **Different UUIDs.** Every send would 400/404 and be silently counted as `skipped`. This has to be fixed before the wiring is worth doing — pick one identity and use it on both sides (device id is the safer choice, since it survives a restore and matches the RevenueCat app user id).

### 5.3 MAJOR · Local reminders are never re-scheduled after permission is granted — **FIXED 2026-09-02**

`resealReminders` returns early when permission is not granted, and it is triggered only by:

```ts
useEffect(() => { ... }, [round?.date, round?.locks_at, sealedCount]);
```

On day one the ordering is: home mounts (no permission → early return) → player seals five (each seal re-runs the effect, still no permission) → the summons asks → permission granted → **nothing re-runs the effect**. Whether the day-one player gets any reminder at all depends on which control they use to leave the round: `RETURN AT NOON` does `router.replace("/")`, which remounts home and reseals; the TopBar's `‹ RETURN` does `router.back()`, which does not.

With §5.1 unfixed, the local reminders are the *only* thing bringing anyone back — and their day-one delivery is decided by a button choice.

**Fix:** re-run `resealReminders` after the summons resolves (or subscribe to permission state), so the schedule is written the moment the player says yes.

---

## 6. Launch blockers and ops

### 6.1 CRITICAL · Two placeholder strings stand between the repo and App Review

- **`app.json:44`** — `"organization": "SENTRY_ORG_TBD_BY_ERIK"` in the `@sentry/react-native/expo` plugin. This is a build-time config, not a runtime one; it will fail or silently misconfigure source-map upload on every EAS build.
- **`config/links.ts`** — `PRIVACY_URL` resolves from `EXPO_PUBLIC_PRIVACY_URL` and is `null` without it. The paywall then renders **no privacy link at all**. Apple requires a reachable privacy policy link on a subscription screen; this is a straight rejection. The code degrades correctly (better than a dead link), but the env var must exist before submission and there is no `.env` in the repo to confirm it does.

`SHARE_URL` is in the same state: absent → the share message ships with no link, so the challenge cannot be answered and the viral loop stays open-circuit. Flagged in the 2026-09-01 audit; still true.

### 6.2 MAJOR · No universal links, no OTA updates

`app.json` sets `"scheme": "oracle"` but declares no `associatedDomains` and nothing in the app composes an `oracle://` URL. Even with `SHARE_URL` set, a share link opens a web page, never the app.

There is also no `expo-updates` config and no `runtimeVersion` — the spec's plan for iterating via OTA during the traction window (design §7, §10) is not wired.

### 6.3 MAJOR · The documented secret list is stale — **FIXED 2026-09-02**

`wrangler.jsonc`'s comment lists eight secrets. `WorkerEnv` declares two more that are not in it — **`REVENUECAT_WEBHOOK_SECRET`** and **`APPLE_BUNDLE_ID`** — plus the two OneSignal keys that §5.1 will need. An unset `REVENUECAT_WEBHOOK_SECRET` silently 401s every purchase event (§4.2), and an unset `APPLE_BUNDLE_ID` falls back to `"com.erikt.oracle"`, which happens to be right today and is a landmine if the bundle id ever changes.

### 6.4 MINOR · The evergreen bank's poison-skip is only half a guard — **FIXED 2026-09-02**

`publishFromBank` retries past entries that fail `DraftSchema.safeParse`, but `upsertDraft` is called **outside** that try/catch and throws on `"resolves_at out of range"` / `"weather must lock before noon"`. Such an entry is never marked used, so it jams the loop on every tick — on the one path whose entire purpose is that the drop never fails.

`POST /admin/bank` correctly rejects non-`after-lock` drafts at ingest, so this is only reachable via a hand-inserted row or a pre-guard entry. Still: wrap `upsertDraft` in the same skip-and-burn path the parse failure gets.

### 6.5 MINOR · `apps/mobile/README.md` is the untouched `create-expo-app` template

Including "run `npm run reset-project` … create a blank **app** directory". Harmless until someone follows it.

---

## 7. Smaller findings

- **Crowd polling burns a request every 10 s all day.** `useCrowdSoFar` has `refetchInterval: 10_000` and home enables it on any seal — where its only consumer is `crowdLean`, which tints the orb's glow. Combined with `useNow(1000)` in `OracleClock`, home re-renders every second and hits the API every ten. Consider pausing the crowd poll on home, or lengthening it.
- **`RiteConfirm`'s scrim does not cover the safe-area gutter.** It is `StyleSheet.absoluteFill` inside `Screen`'s *padded* inner view, so on a notched phone the strike confirmation leaves live content visible in the top/bottom margins.
- **`idempotency_key` is required by `PredictionSubmitSchema` and never read.** The unique index does the real work; the field is dead weight in the contract.
- **Dead code:** `ui/ConfidenceSlider.tsx` (0 importers) and `game/epigraph.ts` (referenced only from comments and its own test) — both superseded by the pull gesture and `OracleClock`.
- **All-closed / none-sealed round state.** If the app is left open across the lock, `nextOpenQuestion` returns undefined with nothing sealed and `CrowdReveal` renders an empty gold frame with `0 ORACLES HAVE SPOKEN`. Only reachable by holding the app open through noon (a refocus refetches and 404s into `SleepsPanel`), but it is a broken frame when it happens.
- **`shieldNotice` and the free shield are keyed on different clocks.** Settlement writes `freeShieldUsedAt = roundDate`; `/me/ledger` computes availability against `America/New_York` month via `Intl` — these agree, but `streak.ts`'s own `month()` helper compares the raw ISO prefix of the stored date. They line up today; a note is warranted since three places now own "which month is it".
- **`allSpectator` reveals hide day points entirely,** which is right, but they also hide the ledger lines — so a lapsed player sees no streak state at all on the one screen that told them they lapsed.

---

## 8. What is genuinely excellent — do not touch

- **The seal.** Pull → ratchet haptics → ceiling stop at 95 → throw from the fingers' release point → crowd verdict printing in a stationary footer while the next card uncovers. Every piece of it is considered, and the `buttonsMode` twin (hold-to-charge) is a real equivalent rather than a fallback.
- **The payoff line.** `+50 IF RIGHT · −130 IF WRONG` under the reading is the most game-theory-literate thing in the app and the clearest possible statement of why honesty is optimal.
- **The anti-herding wall,** end to end: `/today` carries no side counts, `/today/crowd` is sealed-only and caller-scoped, `/today/mine` is caller-only, undealt cards render symbol-only static.
- **Layout stability.** `callSlotHeight`, the reserved state and notice rows, `PLAQUE_MIN_H`, the fixed footer slot — home is at its final composition on frame one. This is the detail that separates the app from a jam entry, and the comments explaining *why* each slot exists are exemplary.
- **The window fix has landed properly.** `resolves_at` required, `lockFromResolvesAt` deriving the lock in code, weather forced to an instant, validation before any write. The 2026-09-01 hole is closed.
- **Degrade-never-crash discipline** across every native SDK: a missing key leaves that sense dark, shared in-flight promises prevent double-init, and the fresh-install race is handled in three separate places.
- **Retry-safe settlement** with player-favourable write ordering, and the relative `GREATEST(shields - 1, 0)` decrement that refuses to clobber a concurrent purchase.
- **The copy bank and its lint.** One register, versioned, hand-written, enforced. Most apps lose their voice by month three because nothing enforces it.

---

## 9. What I would do, in order

**Today — the honesty fixes — ✅ DONE 2026-09-02:**
1. ~~Gate the rescue offer on `streak >= SHIELD_MIN_STREAK`.~~ (§4.1) — new pure `game/rescueOffer.ts`, wired in `index.tsx`; a property test asserts an offered shield is always one `settleStreak` would actually spend. Rite XI now states the three-day floor out loud, with a copy-lint tripwire pinning that wording to `SHIELD_MIN_STREAK`.
2. ~~Apply `VERDICT_MIN_PLAYERS` to `CrowdReveal`'s percentage and bar.~~ (§2.1) — under five players the finale prints the shared `GATHERING_LINE` in place of the gauge and the percentage; the player's own call still prints, since it is true at any crowd size.
3. ~~Reword the sub-20 tide verdict so the promise is not carried by colour.~~ (§2.2) — between the two floors the line now reads `FEW STAND WHERE YOU STAND`. A test sweeps every crowd size and side to assert "AGAINST THE TIDE" appears if and only if `against` is true. Band edges now derive from `CONTRARIAN_CROWD_PCT` rather than a hardcoded 40, closing part of §2.3.

**This week — legibility — ✅ DONE 2026-09-02:**
4. ~~Name the goal.~~ (§1.1) — new rite V defines the score and the verb ("THE LEDGER RATES EVERY CALL AGAINST WHAT HAPPENED. FIFTY RATED CALLS WRITE YOUR ORACLE SCORE."), new rite XI defines "vigil", rite IX now states the bounty's crowd floor. `SCORE_GLOSS` prints under the plaque's score row — how it is earned while unwritten, what it measures once written, including that nothing purchasable touches it. Lint tripwires pin all three numbers to `SHIELD_MIN_STREAK`, `CONTRARIAN_MIN_CROWD` and `ORACLE_SCORE_MIN_CALLS`.
5. ~~Split the rites.~~ (§1.2) — the canon is reordered so the six a first card depends on come first; `OPENING_RITES_LINES` is literally `RITES_LINES.slice(0, 6)`, so a rule's numeral means the same thing on both screens. First-timers get "The first rites" + BEGIN and a quiet link to the remaining seven; the standing rail opens the full thirteen with RETURN.
6. ~~Show the player's own call and the crowd split on reveal rows I–IV.~~ (§3.1) — `callLine` prints `YOU: YES @ 75% · CROWD 62% YES`. Required adding `crowd_count` to the reveal payload and schema so the crowd clause holds the same floor as the round footer; the Big One's own `CROWD SAID` line now holds it too, printing `TOO FEW SPOKE TO READ THE CROWD` below it.
7. ~~Move the summons off the fifth seal.~~ (§1.4) — the round-screen trigger is gone; home's focus effect is now the only asker, so the crowd finale is never covered.
8. ~~Visible skip on the Calling.~~ (§1.3) — a quarantined SKIP control fades in after the first beat. The full-screen tap surface is now `accessible={false}`, so VoiceOver is offered one real button instead of a screen-sized one wrapping the text it should read.
9. ~~Withhold day points until every row has resolved.~~ (§3.2) — the slot prints `III OF V READ` / `DAY POINTS WITHHELD` while anything is pending, and the share button is withheld with it so a provisional card cannot leave the app. The headline slot is height-reserved so the number arrives rather than shoves.

**This week — the second hit (≈1 day):**
10. Reconcile the OneSignal external id (device id on both sides), then wire `composeHingePushes` → `sendPushes` into `settle`, with the four Plan-4 obligations from `compose.ts`'s own header. (§5.1, §5.2)
11. Re-run `resealReminders` after the permission grant. (§5.3)

**The second hit — ✅ DONE 2026-09-02:**
10. ~~Reconcile the OneSignal external id, then wire `composeHingePushes` → `sendPushes` into `settle`.~~ (§5.1, §5.2) — the sender now addresses a player's DEVICE ids, the alias the client actually logs in as, and `settle` composes and sends before it narrates, reporting `push: N sent, M skipped` in the Telegram round report. All four Plan-4 obligations are met and tested: the lapsed line fires only on the transition into silence (the previous round's own predictions are the marker, so no new column), a batch cannot exist for an unsettled round, "results" is per-player so an all-void day no longer claims the ledger read them, and the audience is `settleRound`'s own stamp rather than every install that ever existed. **Keyless it no-ops cleanly** — nothing here waits on the OneSignal account; when it exists, it is two secrets.
11. ~~Re-run `resealReminders` after the permission grant.~~ (§5.3) — moved onto Home's focus effect, which is where the summons returns to. Covers strictly more than the old data-only effect did.

**Before submission — ✅ what could be done was:**
12. Sentry: the placeholder org is gone. `app.config.js` configures the plugin from `SENTRY_ORG` and **drops it entirely when unset**, so a build can never carry a pretend org — Sentry degrades dark like every other SDK here. ⏳ **Still needs Erik:** `SENTRY_ORG`, and `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_SHARE_URL` in EAS (both need a domain / an ASC app id; the code already degrades correctly without them). (§6.1)
13. ~~Update the `wrangler.jsonc` comment.~~ (§6.3) — now mirrors `WorkerEnv`, grouped by what breaks without each secret. An unset `REVENUECAT_WEBHOOK_SECRET` also logs a distinct error instead of looking identical to an attacker probing. ⏳ **Still needs Erik:** actually setting them.
14. ~~Reset RevenueCat/OneSignal identity on strike.~~ (§4.3) — `resetIdentity()` on both SDKs, plus `queryClient.clear()`, so the struck player does not land on Home still wearing their old epithet.

**Also done, from the smaller lists:**
- ~~Client-side entitlement reconciliation after purchase.~~ (§4.2) — the rescue watches the ledger for the shield rather than asserting it, and says `THE STORE ANSWERED. THE LEDGER WILL RECORD IT SHORTLY.` across the gap. The block now outlives its own offer, so the confirmation no longer vanishes in the same frame as the thing it confirms.
- ~~The evergreen bank's poison-skip.~~ (§6.4) — an entry that passes the schema but throws in `upsertDraft` is burned and skipped like any other, instead of jamming every tick.
- ~~RiteConfirm's scrim.~~ (§7) — a real `Modal`, so it covers the window rather than stopping at Screen's gutters, and Android's back button withdraws the rite.
- ~~Dead code.~~ (§7) — `ConfidenceSlider.tsx` and `epigraph.ts` deleted.

**Still open:**
15. Universal links + `oracle://` deep link into today's round. (§6.2) — needs a domain.
17. `TURN THE LAST CARD` on the reveal. (§3.3)
- The remaining §7 notes: the 10s crowd poll on Home, `idempotency_key` validated and never read, the all-closed/none-sealed frame.
