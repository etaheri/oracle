# ORACLE — The Vigil's Stake, the Player's Standing, and the Window's Leak

**Date:** 2026-09-02 (28 days to Shipaton deadline)
**Status:** design, awaiting Erik's review
**Origin:** five questions from Erik, 2026-09-02, answered in session. Three rulings taken:
the vigil scales day points; standing ships as a percentile, not a board; the window leak is
measured before it is fixed.
**Baseline:** `main` @ `83bc33c`. core 82 / mobile 249 / api 265 green, typecheck clean.

---

## 0. What this is

Five workstreams, in dependency order. A–C are new behaviour; D–E are two bounded UI
defects diagnosed to the line.

| | Item | Shape | Touches |
|---|---|---|---|
| **A** | The vigil weighs the day | core + api + mobile + migration 0005 | scoring, settlement, reveal, copy |
| **B** | Your standing among sealed records | api + mobile | `/v1/me/ledger`, plaque |
| **C** | The window's leak, pooled and readable | api only | extends existing `pipeline/leak.ts`, no migration |
| **D** | The ledger's first-load jump | mobile | `ledger.tsx` |
| **E** | The rites' two returns | mobile | `rites.tsx` |

A is the only one with a correctness trap in it. It is written up first and at length
because getting it subtly wrong reintroduces the exact bug the 2026-08-31 audit removed.

---

## A. The vigil weighs the day

### A.1 The problem

The vigil currently protects nothing. `streakCurrent` feeds exactly two things: the
`THE UNSHAKEN` epithet at ≥7 days (`epithet.ts:48`) and a plaque row. It does not touch day
points. It does not touch the Oracle Score — and `SCORE_GLOSS.written` tells the player so
in as many words: *"NOTHING PURCHASABLE TOUCHES IT."*

So the app sells a consumable (the shield, $2.99) that defends a number the app has
explicitly told the player does not count toward the thing the app says is the point. The
copy gap around shields is real and fixed in A.6, but copy is not the disease. The vigil
needs a stake.

### A.2 The ruling: a symmetric multiplier on the day's total

A new pure function in `@oracle/core`:

```ts
export function vigilMultiplier(streak: number): number {
  const days = Math.min(Math.max(streak, 0), C.VIGIL_MULT_MAX_DAYS);
  return 1 + C.VIGIL_MULT_PER_DAY * days;
}
```

with `VIGIL_MULT_PER_DAY = 0.05` and `VIGIL_MULT_MAX_DAYS = 10` — so the multiplier runs
1.00 → 1.50, reaching its ceiling at ten days. Both constants are ⚙ tunable during
TestFlight.

It is applied to the **day's total**, after the first-hour bonus:

```ts
export function vigilPoints(dayTotal: number, streak: number): number {
  return Math.round(dayTotal * vigilMultiplier(streak));
}
```

### A.3 Why symmetric — the part that must not be got wrong

**The multiplier applies to negative day totals exactly as it applies to positive ones.**
This is not a stylistic choice. It is the correctness requirement, and it is the whole
reason this design is safe.

The day's total `S` is a sum of proper affine-Brier terms. The multiplier `M` is fixed by
the streak the player carried *into* the day — it is determined before any of today's
outcomes exist and cannot be influenced by today's reports. So `M` is a positive constant
with respect to the player's choice of confidence:

> `E[M · S] = M · E[S]`, and since `M > 0`, the argmax over confidence is unchanged.
> Honest belief remains the expected-points maximiser. Properness is preserved exactly.

Now the trap. If the multiplier were applied **only to winning days** — the intuitive
"reward the streak" reading — the payoff becomes `M·S` for `S > 0` and `S` for `S ≤ 0`.
That function has a convex kink at zero, and a convex transform of a proper score **rewards
variance**: the player maximises expected points by reporting *more* confidence than they
hold. That is precisely the bug the 2026-08-31 gameplay audit found in the old contrarian
`×2` (`scoring.ts:20-23`, "contrarian ×2 applies to wins only … optimal report is
c*=2p/(1+p)"), and precisely why `CONTRARIAN_BONUS` was rewritten to be additive.

**Do not reintroduce it.** A property test is mandatory here (A.7).

**Consequence, and it is intended:** a long vigil amplifies bad days as well as good ones.
At a ten-day vigil a losing day costs 50% more. This is the stake — it is what makes the
vigil worth keeping and therefore what makes the shield worth buying. It is also
thematically exact: the longer your vigil, the more the ledger weighs your calls.

**Noted, not fixed:** the existing `FIRST_HOUR_BONUS` *is* asymmetric — `dayPoints()`
returns early when `sum <= 0`, so it is a positive-only bonus with the same convex kink
described above. It is a mild pre-existing properness leak on a fixed +10%. It is out of
scope for this spec and should not be changed in this run; recording it so the next
scoring pass has it.

**Also noted:** a large `M` may make a risk-averse player shade toward the 55 floor to
reduce swing. That is a psychology effect, not a properness break — expected value is still
maximised at truth — and it exists at `M = 1` too. If it shows up in TestFlight, lower
`VIGIL_MULT_PER_DAY`.

### A.4 Where the multiplier comes from: the incoming vigil, stamped once

`day_points` is **computed on read** (`routes/round.ts:117`), and there is no per-user
per-round table. So a naive `vigilMultiplier(user.streakCurrent)` at read time would
silently rewrite every past reveal every time the streak changed — which breaks the app's
most load-bearing promise, *"NOTHING IS REVISED. NOTHING IS FORGOTTEN."*

The multiplier must therefore be **stamped at settlement and never recomputed**.

The value to stamp is the **incoming** streak — `u.streakCurrent` as read at the top of
`settleRound`'s loop (`settlement.ts:34`), *before* `settleStreak` returns the new one.
That is the vigil the player had actually earned before this day, it is the value that is
fixed before the day's outcomes, and it is therefore the value that keeps A.3's properness
argument true.

**New table** (migration 0005):

```ts
export const userRounds = pgTable("user_rounds", {
  userId: uuid("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  vigilMult: numeric("vigil_mult").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.date] })]);
```

Written inside `settleRound`'s per-user loop, **only for users who played that day**
(`played === true` — a user who did not play has no day to weigh), with
`ON CONFLICT DO NOTHING`. Do-nothing rather than do-update is the point: the vigil is
stamped once, and a re-settle or a crash-retry must not revise it.

Note `numeric` comes back from drizzle as a **string**, matching `crowdYesPct` / `brier` /
`marketProb` — every read site must `Number()` it, as the existing routes already do.

`resettleRound` recomputes truth but must **not** touch `user_rounds`.

### A.5 What the reveal does

`GET /v1/round/:date/reveal` reads the row and returns the stamped multiplier alongside the
weighted total.

**Absent row = the day is not yet weighed.** Settlement runs at the noon tick, but
resolution retries hourly to noon D+2, so there is a real window where a player can reach
the reveal before settlement has stamped them. Showing an unmultiplied total that later
grows is exactly the provisional-number bug the 2026-09-02 audit §3.2 just fixed. So:
**if there is no `user_rounds` row, take the existing "DAY POINTS WITHHELD" path** rather
than inventing a second partial state. This composes with the Sept 2 fix instead of
fighting it, and the share button stays withheld with it.

**Per-question points stay unmultiplied.** The card promised `+38 IF RIGHT · −62 IF WRONG`
at seal time (`payoffLine.ts`); the reveal's per-row `✓ +49` must still match that promise.
The multiplier is the day's, so it appears once, as the day's own line:

```
VIGIL OF VII · THE LEDGER WEIGHS ×1.35
```

sitting with the first-hour badge, above the rolled day total.

### A.6 The copy gap

Independent of the mechanic, and worth doing even if A were cut:

1. **The shield rule moves into the opening rites.** Today it is rite XIII — the last of the
   seven deferred rules, behind a QuietLink. A player walking the intended path (opening
   rites → BEGIN) never reads it, yet `SHIELDS IN RESERVE` is a permanent plaque row and
   `RAISE THE SHIELD` is a real-money purchase on home.

   Mechanically this is a **reorder of the canon, not an insertion**:
   `OPENING_RITES_LINES` is literally `RITES_LINES.slice(0, OPENING_RITES)` (`copy.ts:196`),
   and the comment above it records that the order is load-bearing. The shield rule and the
   new vigil-stake rule (2) must be moved *up* into the opening block and `OPENING_RITES`
   raised to match. The constraint from the 2026-09-02 audit §1.2 fix still binds: **a
   rite's numeral must mean the same thing on both screens**, which the slice guarantees so
   long as nothing is inserted mid-list without renumbering both readings together.
2. **A new rite states the vigil's stake** — that the vigil weighs the day, in both
   directions. Without it the multiplier is an unexplained number.
3. **The paywall states the mechanic.** `paywall.creed-*` argues poetically and never says
   what a shield does. It must state the three-day floor (`SHIELD_MIN_STREAK`) and the
   `+3 per period, capped 5` grant (`PLUS_SHIELDS_PER_PERIOD` / `PLUS_SHIELDS_CAP`).
4. **The plaque's vigil row gets a gloss**, the way `SCORE_GLOSS` now serves the score row.

All new lines go through the copy bank and its lint. Per the precedent set by the FIFTY
rule, **add lint tripwires pinning any line that states a number to its constant** —
the three-day floor to `SHIELD_MIN_STREAK`, the ceiling to `VIGIL_MULT_MAX_DAYS`.

### A.7 Tests that must exist

- **Property: properness under the multiplier.** For a grid of streaks 0…30 and true
  beliefs `p` across the 55–95 range, the expected-points-maximising report is the honest
  one. This is the test that would have caught the old contrarian bug; it is the reason A
  is safe.
- **Symmetry:** `vigilPoints(-100, 10) === -150` as surely as `vigilPoints(100, 10) === 150`.
- **Ceiling:** streak 10, 11, and 400 all give 1.5. Streak 0 and 1 give 1.0. Negative
  streak clamps to 1.0.
- **Stamped once:** settle, re-settle, and a crash-retry of the same round leave
  `vigil_mult` at its first value.
- **Not stamped for non-players.**
- **The truth wall holds:** a snapshot asserting `oracleScore` / `completeRoundBriers` are
  byte-identical with and without any vigil. Nothing purchasable may touch the score, and
  the shield is purchasable.
- **Absent row → withheld,** not zero and not unmultiplied.

---

## B. Your standing among sealed records

### B.1 Ruling

**Percentile, not a leaderboard.** Oracle Score needs 50 rated calls = ten days minimum, so
a ranked board is empty for the first ten days after launch and thin for weeks — the same
failure class as the crowd-of-one bug fixed on 2026-09-02. A percentile works from the
first rated day, at any population, with no names, no moderation surface, and no App Review
UGC obligation (guideline 1.2).

It is also the honest answer to the player's actual question — *am I one of the people who
can see* — which a rank of 3-of-11 does not answer.

### B.2 What it ranks, and why that matters

**Oracle Score, never day points.** Day points now carry the vigil multiplier (A), the
contrarian bonus, the Big One double, and the first-hour bonus — and the vigil is
purchasable-adjacent via the shield. Oracle Score is raw Briers, and nothing purchasable
touches it.

Ranking standing on Oracle Score *precisely because* nothing purchasable touches it makes
the truth wall load-bearing rather than decorative. It is also the answer if anyone asks
why a competitive standing sits in an app with consumable purchases. A day-points standing
would put money adjacent to rank and should not ship.

### B.3 Shape

`GET /v1/me/ledger` gains two fields:

```json
{ "percentile": 94, "cohort_size": 312 }
```

- Cohort = users with a non-null `oracle_score`. `users_oracle_score_idx` already exists.
- Two cheap counts: cohort size, and how many score strictly below the caller.
- `percentile` is `null` unless the caller has a written score **and**
  `cohort_size >= PERCENTILE_MIN_COHORT` (proposed **20**, matching the spirit of
  `CONTRARIAN_MIN_CROWD` — a percentile over eleven people is mostly the reader).
- Below the floor, the plaque prints a gathering line, the way the finale does.

Plaque row sits under the score and its gloss. One new bank line.

---

## C. The window's leak, measured

### C.1 Ruling

**Measure before fixing.** `lockFromResolvesAt` (`draft.ts:75`) already guarantees the
answer cannot *exist* before the lock. What it cannot guarantee is that **uncertainty has
not decayed** — Erik's case: the question resolves at an instant, but at 11am the NYC sky
has already told you. Nobody currently knows the magnitude; the 2026-09-01 audit recorded
that no telemetry on leak exists at all.

The magnitude decides everything downstream. If late seals beat early seals materially,
then B's percentile — and any future board — ranks patience, not foresight.

### C.2 CORRECTION — most of this already exists

**Written before checking the repo; the 2026-09-01 window-integrity pass already built it.**
`apps/api/src/pipeline/leak.ts` (shipped Sept 1, tested in `apps/api/test/pipeline-leak.test.ts`)
already provides:

- `crowdDrift(rows)` — YES% among the first quartile of sealers vs the last, in points.
- `lateEdge(rows)` — mean Brier of the earlier half minus the later half. **Positive means
  late sealers scored better** — exactly the metric this section set out to build.
- `earlyLockRate(qs, defaultLocksAt)`, `leakReport(...)`, `loadLeakRows(db, questionId)`.

It is wired into `settle` (`actions.ts:14,195,206`) and prints a `LEAK WATCH` block in the
Telegram round report. Its header comment also already records the self-selection caveat
this spec was going to add — in a sharper form, noting the first-hour bonus biases
`lateEdge` *negative*.

**Nothing here needs rebuilding.** Do not create `packages/core/src/leak.ts`.

### C.3 What is actually missing

Three real gaps remain, and they are small:

1. **It is per-question, per-round, at settle.** The report answers "did *this* question
   leak", never "does the window leak across every round so far" — which is the question
   that decides whether B's percentile ranks foresight or patience.
2. **It is only readable in Telegram,** one day at a time, with no history.
3. **`MIN_SEALS = 8` per question** means at launch scale nearly every question reports
   `null`. Pooling across rounds is what makes the metric computable at all right now.

So C reduces to: **pool the existing metrics across all resolved rounds, and expose them
where Erik can read them.**

- New pure `pooledLeak(rows: SealRow[][]): { drift, edge, n, questions }` in the **existing**
  `apps/api/src/pipeline/leak.ts`, reusing `crowdDrift` / `lateEdge` semantics over a
  pooled row set rather than a single question's.
- New `GET /admin/analytics/leak` behind the existing admin auth, with optional `?since=`,
  returning the pooled figures plus per-round rows.
- The response carries the same caveat `leak.ts`'s header already states, so a reader of the
  JSON gets it without reading the source.

No migration. No new package. No change to the settle-time report.

### C.4 Explicitly not in scope

The principled fix — grading each call against a difficulty bar that decays across the
window — is a scoring-engine rewrite, and the contrarian rule was already rewritten this
week. Not now. The author-side decay constraint is likewise deferred until C says whether
it is needed.

---

## D. The ledger's first-load jump

### D.1 Diagnosis

Not the plaque — the **column**.

`ledger.tsx:126` (loading) renders **two** children inside `{ flex: 1, justifyContent: "center" }`:
the eyebrow and the plaque frame. `ledger.tsx:158` (loaded) renders **seven**: eyebrow,
plaque, the Oracle Plus link, the liturgy block, `DECLARE YOURSELF`, `Strike the record`,
and the gaps between them.

Loading column ≈ 434pt. Loaded column ≈ 665pt. Both centred. So when the record lands the
plaque's top **shoves up ~115pt** — the exact element `PLAQUE_MIN_H` was built to hold
still. The `PLAQUE_MIN_H` work is correct and worked; the skeleton simply stops at the
plaque's own border while the jump comes from everything below it.

### D.2 Fix

Delete the early-return branch. Render the column **once**, and swap only the plaque's
*interior* between the `AsciiDust` / `THE LEDGER IS CONSULTED` state and the real record.
The liturgy, both quiet links, and the share button do not depend on `ledger.data` at all —
only `handleShare` does, so the button renders disabled while loading. This is strictly
less code than what is there now and removes the class of bug rather than this instance.

Second, smaller jump, same screen: the Apple claim row (`ledger.tsx:196`) appears after an
async `isAvailableAsync()` and adds ~70pt *inside* the plaque — and 420 is a `minHeight`,
not a height. Reserve its row, or resolve availability before first paint.

`PlaqueShareCanvas` is `position: absolute, left: -9999` and contributes no layout —
verified, not a factor.

---

## E. The rites' two returns

### E.1 Diagnosis

On the `?all=1` reading the screen carries **two** return controls: `‹ RETURN` in the
TopBar — which is a sibling *above* the ScrollView, so it never scrolls away — and a
full-width `GoldButton "RETURN"` pinned to the bottom (`rites.tsx:104`).

The GoldButton is the app's highest-emphasis control; everywhere else it marks a commitment
(BEGIN, DECLARE YOURSELF, KEEP THE VIGIL, READ THE LEDGER). Spending it on "go back" makes
the loudest element on the page of rules the exit, duplicates a permanently-visible
control, and costs ~64pt on a screen that already overflows thirteen rules.

The inverse holds at the top. `index.tsx:185` does `router.push(ritesSeen ? "/round" : "/rites")`,
so on the **opening** reading TopBar's `‹ RETURN` gives a first-timer a way out of what is
meant to be a gate.

### E.2 Fix

- `all=1`: drop the fixed bottom GoldButton. Consistent with `/ledger` and `/plus`, neither
  of which has a bottom return.
- opening: suppress TopBar's return so `BEGIN` is the only way forward.

One `opening` boolean already distinguishes the two readings; both changes hang off it.

---

## F. Order, and what gates what

1. **D and E** — independent, bounded, no dependencies. Land first; they unblock nothing but
   they are the two Erik can see immediately.
2. **C** — independent of A and B. No migration, pure core + one admin route.
3. **A** — the long pole. Migration 0005, core scoring, settlement, reveal, copy. The
   property test in A.7 gates the rest of A.
4. **B** — after A only because both touch `/v1/me/ledger` and the plaque; no logical
   dependency.

**Ops gate (Erik):** migration 0005 needs applying to dev **and** prod Neon by hand. Per the
project's own record there is still no `__drizzle_migrations` bootstrap, and **prod has not
had 0004 applied yet**. A cannot ship to prod until that is resolved.

---

## G. What this deliberately does not do

- No leaderboard, no handles, no UGC surface.
- No change to the 24h window (the HQ Trivia appointment argument holds).
- No change to the scoring rule's shape beyond the symmetric day multiplier.
- No change to `FIRST_HOUR_BONUS`, despite A.3's finding.
- No archive, no Plus repositioning — the vigil-gets-a-stake ruling makes the current Plus
  offering honest, which was the goal.
