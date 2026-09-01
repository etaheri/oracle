# ORACLE — Window, Seeding & Story Audit

**Date:** 2026-09-01 (29 days to Shipaton deadline)
**Scope:** the game as it plays on `main` @ `57fea6c` (all three gameplay-audit plans + Revenue Rites merged), read end to end. Three questions: is the open window sound from a game-theory standpoint, is question seeding good enough, and does the app tell a story worth finishing.
**Relationship to the prior audit:** `2026-08-31-gameplay-audit.md` is largely *executed* — contrarian is additive, the crowd floor exists, `/today` self-locks, receipts are on the reveal, the partial day is named, RevenueCat ships. This document does not re-litigate those. It goes at what the fix run did **not** touch.

---

## 0. Verdict in one paragraph

The loop is well made and the scoring rule is now proper, but the game has a hole underneath it that no amount of scoring polish can close: **the authoring contract requires every question to be answerable roughly an hour before the round locks.** A player who opens the app at 11:55 AM and looks up the news outscores the best honest forecaster in the game by about 2.5×, and the first-hour bonus is structurally incapable of compensating — it is 10% of your score, while lateness changes what your score *is*. This is one prompt clause and one schema default; both are cheap to fix, and fixing them is worth more than every other item in this document combined. Seeding is architecturally right (contract, validation, retry, dedupe, market signals, evergreen bank) but flies blind: nothing measures whether a question was contested, whether it leaked, or whether `author_probability` means anything, and nothing feeds outcomes back into the next day's prompt. On story, the app writes a check its cold open never cashes — the Calling promises a three-thousand-year search for those who see, and the search has no ending; the Oracle is a named character with no record of its own; and "nothing is forgotten" ships without an archive.

---

## 1. The open window — the game-theory hole

### 1.0 First, the window is 24 hours, not 12

`upsertDraft` sets `opensAt = noonET(date)` and `locksAt = noonET(date + 1)` (`pipeline/draft.ts:60-61`). A round is open **noon ET to noon ET**. The problem you're pointing at is real, and it is twice the size you thought.

### 1.1 CRITICAL · The authoring contract guarantees the leak

`pipeline/author.ts:77`:

> "Each question must be binary YES/NO in plain English, **resolvable by 11:00 AM ET on {D+1}** from ONE named public source."

The round locks at **noon ET on D+1**. So by construction, every question's answer is publicly available from a named source **at least one hour before answers close**. The anti-leak mechanism is the per-question `locks_at`, but:

- it is **optional** — `locks_at: z.iso.datetime().nullable().default(null)` (`draft.ts:29`), and null means noon D+1, the maximally-leaky value;
- it fires only on the model's own judgment of when an outcome "begins to become knowable" (`author.ts:80`), a policy call an LLM is bad at, applied to a question the contract just told it must be knowable before lock;
- nothing validates it, nothing measures it, and nothing reports it. There is no telemetry anywhere on how many questions actually carry an early lock.

The design spec saw this coming — §128: *"Leaky questions lock early: answers gain information through the day (a market question at 11pm is half-resolved)"* — and the mechanism was built. But the prompt that is supposed to drive it contradicts it in the line above, and the default is set the wrong way.

**Market-adapted questions are the worst case.** `feeds.ts` pulls markets closing within `HORIZON_MS = 36h` of authoring (17:00 ET D−1), i.e. closing by ~05:00 ET on D+1 — seven hours before lock. A question adapted from a Polymarket market closing at 05:00 is not just resolvable at 11:55, it has had a public price converging on the answer all night. The prompt correctly forbids *citing* a market as the resolution source; it does nothing to stop a player from reading one.

**Weather cannot be fixed by `locks_at` at all.** A weather question authored at 17:00 for a measurement by 11:00 the next morning is an 18-hour forecast at open and a nowcast at lock. The information arrives continuously, so there is no single moment to lock at. Weather is structurally the wrong category for this window unless the measurement period begins *after* the lock.

### 1.2 The arithmetic — why the first-hour bonus cannot work

Points are `round(mult × 200 × (0.25 − brier))`. At the ends of the scale:

| conviction | right | wrong |
|---|---|---|
| 55 | +10 | −10 |
| 95 | +50 | −130 |
| 95 · Big One | +99 | −261 |

Now compare three players on the same round:

| player | behaviour | expected day points |
|---|---|---|
| Honest early, genuinely sharp (true p = .65 on every question) | opens at 12:05, forecasts well | **+5** (4.5 EV/question × 6 units ≈ 27 before rounding; ≈ 5–27 depending on read strength) |
| Honest early, exceptional (true p = .80) | forecasts very well | **≈ 108**, +11 first-hour bonus → **119** |
| Late looker-up | opens at 11:55, googles five answers, reports 95 | **299** |

*(EV for an honest forecaster at true belief p is `200 × (0.25 − p(1−p))` per question: 4.5 at p=.65, 18 at p=.80, 49.5 at certainty. Six scoring units per round — four ordinary plus a double-weighted Big One.)*

**A player who forecasts nothing beats the best forecaster in the game by ~2.5×, purely by opening the app at 11:55 instead of 12:05.**

The first-hour bonus is `sum + round(0.10 × sum)` on positive days (`scoring.ts:44-48`). It is a **percentage of your own score**, so its maximum possible value is 10% of what you already earned. The advantage it is meant to offset acts on the score itself. No multiplier on a player's own points can ever compensate an information asymmetry — this is structural, not a tuning problem. For the +10% to close the gap you would need less than ~3% of each day's information to arrive during the window, which is false for every category in the list.

Worse, the rites promise it does work — `RITES_LINES`: *"SEAL ALL FIVE WITHIN THE FIRST HOUR. THE DAY PAYS TEN PERCENT MORE."* — and the spec claims it *"compensates early players' information disadvantage."* It does not, by an order of magnitude.

### 1.3 What actually fixes it

Ranked by value per unit of work.

**(a) Make the code, not the model, enforce the lock. ← do this first**

Replace the optional `locks_at` with a **required** `resolves_at`: "the ISO-8601 UTC moment at which the outcome first becomes publicly determinable." The model states a fact (which it is good at) instead of making a policy call (which it is bad at). Then derive the lock in code:

```ts
locksAt = min(noonET(D+1), resolvesAt)   // never lock after the answer exists
```

Drop `.nullable().default(null)`. A draft with no `resolves_at` fails validation and takes the retry path. This makes leakage structurally impossible rather than advisory, and it is testable — a unit test per category.

**(b) Fix the contradictory clause in the prompt.**

Change "resolvable by 11:00 AM ET on D+1" to something that does not guarantee the leak:

> The resolving event must not begin before `resolves_at`, and the outcome must be readable from the named source within one hour after it. Prefer questions whose resolving event lands close to noon ET on D+1 — the ledger is read at 12:10.

The resolution infrastructure already tolerates lateness: `decideActions` retries hourly and only voids at noon D+2 (`state.ts:104`). Only the authoring prompt insists on 11:00 AM D+1.

**(c) Instrument the leak. You currently cannot see it at all.**

`predictions.created_at` is already stored. Three numbers in the daily Telegram report, computed at settle:

- **leak score** per question — `|crowd_yes_pct(last quartile of seals) − crowd_yes_pct(first quartile)|`. A question the crowd changed its mind about over the window leaked.
- **Brier by seal hour** — if hour-23 sealers beat hour-1 sealers by a wide margin, the round leaked. This is the single number that tells you whether (a) and (b) worked.
- **early-lock rate** — what fraction of questions carried a `locks_at` before noon D+1. Today this is unknown, and I would bet it is near zero.

**(d) Retire weather, or reshape it.** Either drop it from `CATEGORIES` or require the measurement window to begin after the lock ("will Central Park exceed 80°F on D+2").

**(e) Stop claiming the first-hour bonus is compensation.** Keep it — it is a real event-culture nudge and it drives the noon drop — but rewrite the rites line and the spec to say what it is. If you want early play to carry actual weight, the honest lever is **non-scoring**: an epithet for the early hand, first-hour count on the plaque, a mark on the share card. Those reward the habit without distorting a scoring rule you just spent a plan making proper.

**(f) Do NOT shorten the window to 12 hours.** It halves the drift, but drift is not the problem — the *guaranteed* leak is, and (a)+(b) close that completely. A 12-hour close costs you the West-coast and night-shift player and reintroduces exactly the HQ-Trivia appointment failure the 24h window was chosen to avoid (spec §21). If you want a live-event feel, the lever is the drop (11:45 summons, pre-drop lobby), not the close.

### 1.4 MAJOR · The burner-peek is still open

`/today/crowd` returns exact `crowd_yes_pct` for any question the caller has sealed, at any crowd size (`round.ts:52-69` — the ≥5 floor is client-side only, in `crowdVerdict`). Mint throttle is 5 devices per IP per hour (`auth.ts:19-20`), so one burner a day is free. Seal all five at 55 on the burner, read the crowd, play the contrarian side on the main account: up to **+120/day** (4×20 + 40), roughly 40% of a maximum day.

This is smaller than §1.1 — it only pays when you are also right — but it should be on the list. Cheapest mitigations: serve bucketed rather than exact percentages below `CONTRARIAN_MIN_CROWD`, or gate crowd visibility on accounts with ≥1 settled round. App Attest is the real answer and is out of scope for the window.

### 1.5 What is genuinely right about the window

The anti-herding wall holds end to end (`/today` carries no side counts; `/today/crowd` is sealed-only and caller-scoped; undealt cards are symbol-only static). Locks are server-clock, per-question, and enforced at submit (`predictions.ts:19`) independent of the cron. Contrarian is scored against the *final* crowd at resolution, so early players cannot be farmed by late ones. Seals are idempotent with no edit path. The payoff line under the reading ("+50 IF RIGHT · −130 IF WRONG") is the most game-theory-literate thing in the UI and should never be removed.

---

## 2. Question seeding — architecturally right, flying blind

### 2.1 What is built

17:00 ET D−1, hourly retry to 23:00: Opus + web search (8 uses) → structured `draft_round` tool call → Zod validation with one revalidation retry → `scheduled` rows → Telegram narration. Contract: 5 slots, Big One at 5, ≥4 distinct categories, `author_probability ∈ [0.30, 0.70]`, resolution criteria + named source required, forbidden-topic list, 7-day text dedupe. Market signals from Manifold + Polymarket (contested 0.20–0.80, ranked trust × contestedness × log volume, top 15) as prompt context. Evergreen bank as the noon fallthrough so the drop never depends on the agent being alive. Operator gets `/reroll <slot> <guidance>`, `/status`, `/flip`.

That is a genuinely good pipeline. Everything below is about the feedback loop it does not have.

### 2.2 MAJOR · `author_probability` is asserted and never checked

The 0.30–0.70 band is the model's self-report. Nothing ever compares it to the crowd or to the outcome. If the author systematically writes questions it labels 0.55 that resolve YES 85% of the time, nothing in the system would notice. **Fix:** at settle, log outcome rate bucketed by `author_probability`, and log `|crowd_yes_pct − author_probability×100|`. Two aggregates in the day report.

### 2.3 MAJOR · Nothing measures contestedness, which is the actual quality metric

A good ORACLE question is one where the crowd genuinely splits. You already store `crowd_yes_pct` and `crowd_count` at resolution. **Contestedness = how close the final crowd is to 50/50** is the number that tells you whether the day was interesting, and it is the number the authoring prompt should be tuned against. A day where all five land at 85%+ consensus is a boring day, and today nothing would tell you it happened.

### 2.4 MAJOR · Outcomes never reach the author — the highest-leverage cheap fix in this document

`recentQuestionTexts` (`author.ts:92-99`) selects the last 7 days of questions and returns **only `r.text`**, joined with semicolons, as a "don't repeat these" list. The author never learns that Tuesday's question voided, that Wednesday's crowd instantly agreed at 91%, or that Thursday's resolution criteria turned out ambiguous.

Change that one query to return text + outcome + `crowd_yes_pct` + void reason, and reframe the prompt block from "avoid repeating" to "here is how your last seven days actually landed." Roughly a ten-line change that turns a dedupe list into a feedback loop. Do this before any prompt tuning — it will do more than the tuning would.

### 2.5 Other seeding gaps

- **MAJOR · No human gate.** Authored at 17:00, published at noon with no approval step. `/reroll` requires Erik awake and reading Telegram; there is no `/hold`. For a brand built on "the ledger does not lie," one bad question published unattended is expensive. Cheapest version: `/hold <slot>` blocks publish for that slot and the bank covers it.
- **MAJOR · Dedupe is textual, not structural.** "Will BTC close above $X" with a different X every day passes the 7-day check cleanly. Ask the model for a `topic_key` and reject repeats of the key within N days.
- **MINOR · No cross-round category balance.** The ≥4-distinct rule is *within* a round only. Nothing stops markets/sports/weather/culture five days running with news never appearing. Feed 14-day category counts into the prompt as an explicit balance instruction.
- **MINOR · The Big One is only defined as "most contested from any category."** Nothing enforces that it is the day's actual headline, and nothing gives it stricter leak scrutiny — even though it does double damage in both directions. It should be the one slot where `resolves_at` is mandatory-and-checked hardest.
- **NOTE · Every question resolves in the same ~24h.** The spec allows 24–48h; the noon ceremony narrowed it to 24. That is the right call for the loop, but it means the game can never ask a genuinely medium-horizon question. Post-window, a weekly "long prophecy" sitting outside the daily round is both a story beat and an obvious Plus hook.

---

## 3. The story — the app writes a check its cold open never cashes

### 3.1 What the app promises

The Calling, on first open ever: *"For thirty centuries they searched for those who see. Pythia. Sibyl. Seer. Each claimed the gift. None kept receipts. So the ledger was built. It does not believe. It records. Sealed before the outcome. Read without mercy. **The search continues. It has reached you.**"*

The liturgy, on every share card: *"Nothing is revised. Nothing is forgotten."*

Those are excellent, and they set up three obligations.

### 3.2 CRITICAL · The search has no ending

The premise is a search for those who see. The mechanic that would resolve it is the Oracle Score at 50 rated calls — the moment the ledger finally names you. Today that moment is a **stat row changing from `UNWRITTEN · 49 OF 50` to a number**. There is no ceremony, no push, no card, no share. The single strongest narrative beat available to this app — *you have been found* — is currently a string change on a plaque.

This is also the retention answer. Fifty rated calls is ten complete days; a player in the first week has no mid-term goal at all between "today's five" and "someday, an epithet." Build the finding: a full-screen rite the first time the score is written, its own share card, and the score progress visible on **home** (it is on the reveal and plaque, not home) so the first ten days read as a countdown to being named.

**Highest story ROI in the app, and most of the machinery already exists.**

### 3.3 MAJOR · The Oracle is a character with no record

`stampForecasts` computes the Oracle's own skill-weighted, extremized forecast at lock and stores it on every question (`actions.ts:19-35`). The player sees it in **one line, on one card, at reveal**: "THE ORACLE FORESAW 62% YES," on the Big One only.

The machine forecasts five questions a day and keeps no record of how it did. Give it one:

- **Per day, at reveal:** "YOU: 3 · THE ORACLE: 4." One line, one comparison, an antagonist.
- **Cumulative, on the plaque:** the Oracle's own Oracle Score next to yours, and how many days you have outseen it.
- The design spec already names this: *"The result reveal has three characters: you, the crowd, and THE ORACLE FORESAW."* Two of the three currently have arcs.

This is a story engine, a difficulty signal, and a retention hook in one, and the hard part (the forecast) is built and tested.

### 3.4 MAJOR · "Nothing is forgotten," but the player can only see yesterday

`/reveal/:date` works for any date; home links only to yesterday and there is no archive surface anywhere. The liturgy's central claim is unbacked. This is also the cleanest thing to sell — an archive of every day you have ever played is exactly the Plus offering the current paywall lacks (today Plus sells shields, which protect a record the player cannot look at).

### 3.5 MINOR · The epithet ladder's default rung is its blandest

`assignEpithet` is priority-ordered, first match wins. Below 5 complete days you are THE UNREAD; above it, most players most weeks will fall through every gate to **KEEPER OF THE LEDGER · "THE LEDGER GROWS. SO DO YOU."** The interesting rungs (TIDE-FIGHTER, HIGH PRIEST, HUMBLE LEDGER) need either 3 tide wins or 20 resolved calls. Add three or four receipted rungs that fire on common early profiles — and make one of them **THE EARLY HAND** (first-hour habit). That is a non-scoring reward for early play, which is exactly the compensation §1.3(e) asks for, at zero cost to the properness of the scoring rule.

### 3.6 What the story gets right — don't touch

The crowd is the best-realized character in the game: hidden until you commit, verdict printed the instant a card is thrown, gold only when the bounty can truly pay (`crowdVerdict` mirrors `contrarianApplies` exactly, crowd floor included). The Calling → Boot Rite → daily liturgy voice ladder is consistent and unmistakable. The copy lint as the voice's guardian is the right architecture — most apps lose their voice in month three because nothing enforces it. The receipts on the reveal (`PER ESPN · "…"`, void reasons) deliver "read without mercy" literally.

---

## 4. Design & delight

### 4.1 The reveal is the weakest-designed important screen

The seal has a full ritual grammar: pull, ASCII charge densifying with conviction, throw from the fingers' position, crowd verdict printing in the stationary footer, numerals filling. It is the best moment in the app.

The reveal is a `ScrollView` of stacked rows in which everything arrives inside ~1.2s (`ROW_DELAY 200` + 4 × `ROW_STAGGER 90` + points at 760ms + Big One at 1110ms), and then it is a summary you scroll. Dopamine hit #2 gets a fraction of the choreography hit #1 gets, for an equally important moment.

**Cheapest large improvement:** gate the Big One behind a deliberate act — "TURN THE LAST CARD" — so the day's headline is a decision, not a scroll position. It reuses the card grammar the player already learned and costs one state variable.

### 4.2 Colour never becomes an event

Ultramarine (YES) and vermilion (NO) carry real semantic weight on the card, and vermilion returns as the loss colour on reveal rows. Everywhere else the app is ink / gold / parchment. Home has no colour event at any point in the day — the only candidate is `LivingHero`'s crowd-mood glow, which is a subtle tint under a loop image. For a game whose whole daily arc is *the crowd took a side and so did you*, there is an unspent opportunity for one colour moment per day at the reveal.

### 4.3 Ship-blocking and near-blocking

- **`plus.tsx:17` — `const PRIVACY_URL = "https://PRIVACY_URL_TBD_TASK_12"`.** A dead link on the paywall. App Review rejects on this. It is the only placeholder left in the source tree.
- **The share message still has no link** — `shareMessage` composes `🔮 ORACLE 2026-09-01 — I✓ II✗ … · +140 · can you outsee me?` with no URL. The challenge is issued and cannot be answered. An App Store URL is a one-line change and should not wait for a domain.

### 4.4 Smaller notes

- The finale after card V, the struck numerals for closed slots, the partial-day line, and the fixed-height footer slot are all well judged. The layout-stability work on home (reserved `CALL_SLOT_H`, `StateRow`) is the kind of detail that separates this from a jam entry.
- `crowdVerdict` prints the exact percentage from the fifth player onward. Consider whether "62% SAY YES" at N=6 is a promise the sample can keep — the floor protects the *bonus* but not the *number*.
- Epithets are 28-day rolling and the plaque never says so.

---

## 5. What I'd do, in order

**This week — the window fix (≈1.5 days, no device build needed):**
1. `resolves_at` required in `DraftQuestionSchema`; derive `locksAt = min(noon D+1, resolvesAt)` in `upsertDraft` and `rerollSlot`. Tests per category. (§1.3a)
2. Rewrite the "resolvable by 11:00 AM ET D+1" clause. (§1.3b)
3. Leak telemetry in the settle report: crowd drift by seal quartile, Brier by seal hour, early-lock rate. (§1.3c)
4. Feed outcomes + crowd % + voids into the authoring prompt instead of bare text. (§2.4)
5. Drop or reshape weather. (§1.3d)
6. Rewrite the first-hour rites line to stop claiming compensation. (§1.3e)

**Also this week — free wins:**
7. Real privacy URL. (§4.3) — blocks submission
8. App Store URL in the share message. (§4.3)

**Next — the story, in ROI order:**
9. The finding ceremony at 50 calls + score progress on home. (§3.2)
10. You vs. the Oracle: one reveal line + a plaque row. (§3.3)
11. Archive behind Plus. (§3.4) — gives the paywall something to sell besides insurance
12. Three or four more epithet rungs, one of them THE EARLY HAND. (§3.5, §1.3e)

**If there is room:**
13. "TURN THE LAST CARD" on the reveal. (§4.1)
14. `/hold <slot>` before publish. (§2.5)
15. Bucketed crowd percentages below the contrarian floor. (§1.4)
16. `topic_key` structural dedupe + 14-day category balance. (§2.5)

Items 1–8 are ~2 days and none of them need the dev client. Items 9–12 are the difference between a well-made daily loop and a game with an ending worth reaching.
