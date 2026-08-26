# The Machine Voice — Design Spec

> Drafted 2026-08-26 from the Co-Star dynamics research
> (`docs/superpowers/2026-08-26-costar-dynamics.md`) and Erik's approval of the
> recommended split. Companion to the brand brief
> (`2026-08-26-oracle-brand-brief.md` §7, machine-voice chrome). This spec
> covers the voice system that rides Plan 3's OneSignal + streak work.

## Scope

**In:** the push copy bank (D1), the two-beat daily ritual (D7), the
credibility liturgy (D5), the Forecaster's Ledger plaque with weekly epithets
(D3), and the voice guardrails as hard rules.

**Out (explicitly):** narrated friend rivalries (D4 — Plan 4, needs a social
graph); fully composed per-question verdict pushes (deep D2 — the noon push
uses count-level personalization only in this phase); Oracle Plus plaque
cosmetics (noted as a hook, not specced).

## 1. The license

Co-Star's bluntness is unfalsifiable, so it periodically reads as random
cruelty. ORACLE's bluntness is **earned**: every line is checkable against the
player's own sealed record and the real outcome. This is the single design
principle everything below serves. A line that cannot cite the ledger does not
get to be blunt.

## 2. Voice guardrails (hard rules, apply to every surface)

1. **Never blunt without receipts.** A harsh line must be derivable from the
   player's record. Aim at the prediction, never the person: "YOUR CONFIDENCE
   OUTRAN YOUR ACCURACY", never "you are overconfident".
2. **Losing days get gravity, not mockery.** A 0/5 day reads like a museum
   label on a noble failure: "THE CROWD WAS WRONG WITH YOU. YOU WERE NOT
   ALONE."
3. **Cryptic in tone, verifiable in substance.** Every claim in a line must be
   true of the ledger. No pure atmospherics posing as facts.
4. **Consistency over cleverness.** One voice, hard style rules, a curated
   bank. No ad-hoc generation, no LLM-composed pushes — assembled templates
   from the bank only.
5. **Register:** mono caps, present tense, complete sentences, no emoji, no
   exclamation marks, no "you have new results", no CTA verbs ("check", "tap",
   "open"). The push is the artifact; the app is where the artifact leads.

## 3. Copy bank (D1)

**Home:** `packages/core/src/copy.ts` — a typed, versioned constant, exported
so the API composes pushes from it, the mobile app reuses lines for in-app
chrome, and vitest can lint every line against the style rules.

```ts
export interface CopyLine {
  id: string;            // stable, e.g. "noon.wrong-one"
  pool: "noon" | "closing" | "streak" | "system";
  text: string;          // slots in {braces}: {n}, {streak}, {epithet}
  requires?: ReadonlyArray<"results" | "streak" | "epithet" | "tideWin">;
}
```

Selection is deterministic: `hash(userId + date) % candidates.length` over the
lines whose `requires` are satisfied — same player, same day, same line
(the oracle does not change its mind), different players get different lines.

**Bank size at launch: ≥60 lines** (≈25 noon, ≈20 closing, ≈10 streak,
≈5 system). Seed set (canonical, more written at build time under the lint):

Closing call (unsealed players, hours before lock):
- "FIVE QUESTIONS. THE ORB IS OPEN UNTIL NOON."
- "THE QUESTIONS ARE POSTED. THE CROWD IS ALREADY MOVING."
- "TODAY'S LEDGER IS BLANK. IT WILL NOT STAY THAT WAY."
- "{n} ORACLES HAVE ALREADY SPOKEN. THE ORB WAITS FOR YOU."
- "THE BIG ONE IS WORTH THE MOST. IT IS ALSO THE HARDEST. THIS IS NOT A COINCIDENCE."

Noon (the hinge: ledger read, new round opens) — tiered, see §4:
- requires results: "THE LEDGER IS READ. YOU WERE WRONG ABOUT {n} THING(S)."
- requires results: "THE LEDGER IS READ. ONE OF YOUR ANSWERS SURPRISED US."
- requires tideWin: "YOU STOOD AGAINST THE TIDE. THE TIDE BROKE."
- requires results: "THE CROWD MOVED. YOU DID NOT. THE LEDGER REMEMBERS WHO WAS RIGHT."
- generic (sealed, no result data yet): "THE LEDGER IS READ. IT DOES NOT READ ITSELF TWICE."
- did not play: "THE LEDGER WAS READ WITHOUT YOU. TOMORROW IT NEED NOT BE."

Streak / retention:
- requires streak: "{streak} DAYS WITHOUT SILENCE. THE ORACLE NOTICES."
- lapsed 1 day: "YESTERDAY THE ORB WENT UNCONSULTED. IT DID NOT GO UNREAD."

**Copy lint (vitest, in packages/core):** every line is uppercase, contains no
emoji/exclamation/CTA verbs, ≤ 140 chars after slot expansion with worst-case
values, and every `requires` slot actually appears in the text. The curiosity
gap is enforced as a test: no noon line may contain a point value or a
win/loss tally beyond a single withheld count ("{n} THING(S)" is the ceiling).

## 4. The two-beat ritual (D7)

The game is globally synchronous — everyone seals before the same noon — so
pushes fire on the round's clock, not per-timezone. The synchronicity IS the
ritual; do not soften it.

ORACLE's clock hinges at noon: round N locks and is read at the same moment
round N+1 opens (opensAt noon day N, locksAt noon day N+1). The beats follow
that clock:

- **Beat 1, THE HINGE (noon):** one push per subscribed player when the round
  resolves, tiered:
  - Players with results → personalized pool (`requires: results`), counts
    only, **never the score, never which questions**. The reveal ceremony owns
    the payoff; the push owns the pull. The new round rides implicitly — the
    reveal screen hands the player forward.
  - Sealed players whose results are somehow not yet composable → generic
    noon line (graceful degradation, never silence).
  - Players who did not play → the did-not-play line, at most once per lapse
    (not daily — that's nagging, which the voice never does).
- **Beat 2, THE CLOSING CALL (three hours before lock):** unsealed players
  only, one push from the closing pool. Players who already sealed hear
  nothing — they spoke; the oracle does not repeat itself. This asymmetry is
  the anti-nag rule made structural: a fully sealed player receives exactly
  one push a day.

**Architecture:** a Workers cron trigger (same schedule that resolves the
round) composes per-tier audiences and calls the OneSignal REST API with the
selected line per segment; per-user personalization uses OneSignal custom
data tags (results count, tide win, streak) written by the API at resolve
time, so one segment send per line covers all users deterministically
assigned to it. No client-side scheduling.

**Permission ask:** never at first launch. The ask comes immediately after the
player's FIRST seal, primed by a machine-voice interstitial: "THE LEDGER IS
READ AT NOON. THE ORACLE CAN CALL YOU WHEN IT IS DONE." → [THE ORACLE MAY
SPEAK] / [SILENCE]. Decline is respected silently; one re-offer only, after
the player's first against-the-tide win (the moment the product has proven
the push is worth having).

## 5. The credibility liturgy (D5)

Canonical line, always verbatim, always mono caps:

> EVERY ANSWER SEALED BEFORE THE OUTCOME. EVERY SCORE READ AGAINST THE CROWD.
> NOTHING REVISED.

Placements: App Store subtitle/description, the push-permission interstitial,
share-card footer (replaces nothing — sits under "CAN YOU OUTSEE ME?" in
smaller mono), onboarding's single explainer screen, marketing site hero.
It is said as ritual — never reworded, never abbreviated, never explained.

## 6. The Forecaster's Ledger plaque (D3)

A profile surface styled as a museum specimen plaque (frescoWhite card,
hairline frame + register marks like CardChrome, mono stat lines, Cinzel
epithet). Route: `/ledger`, linked from home ("THE FORECASTER'S LEDGER"
quiet link).

**Stats (v1 — stat lines, no charts):**
- ORACLE SCORE (existing two-economy score, complete rounds only)
- DAYS CONSULTED and CURRENT STREAK
- ACCURACY (resolved, non-void answers correct %)
- AVG CONVICTION (mean confidence) and the calibration verdict line derived
  from `gap = avgConfidence − accuracy`: gap ≤ ±10 → "YOUR CONFIDENCE IS
  HONEST"; gap > +10 → "YOUR CONFIDENCE OUTRUNS YOUR ACCURACY"; gap < −10 →
  "YOU KNOW MORE THAN YOU CLAIM"
- AGAINST THE TIDE: count of contrarian wins (sidePct < 40, points > 0 —
  same rule as core scoring's CONTRARIAN_MULT)

**Epithet:** one title, recomputed weekly (Monday, over the trailing 28 days),
first matching rule wins. Each epithet renders with its receipt line —
the plaque never asserts identity without evidence.

| Priority | Epithet | Rule (trailing 28d) | Receipt line |
|---|---|---|---|
| 1 | THE UNREAD | < 5 complete rounds | "THE LEDGER KNOWS TOO LITTLE OF YOU." |
| 2 | TIDE-FIGHTER | ≥ 3 against-the-tide wins | "{n} TIMES AGAINST THE CROWD. {n} TIMES RIGHT." |
| 3 | CALIBRATED SKEPTIC | calibration gap ≤ ±10 AND avg conviction < 70 | "YOU CLAIM LITTLE AND MISS LESS." |
| 4 | HIGH PRIEST OF CONVICTION | avg conviction ≥ 85 AND accuracy ≥ 60 | "YOU SPEAK LOUDLY AND THE LEDGER AGREES." |
| 5 | THE HUMBLE LEDGER | calibration gap < −10 | "YOU KNOW MORE THAN YOU CLAIM." |
| 6 | TRUE BELIEVER OF THE CROWD | sided with majority ≥ 80% of answers | "WHERE THE CROWD GOES, YOU GO." |
| 7 | ORACLE OF THE MINORITY | sided with minority ≥ 35% of answers | "YOU WALK WHERE FEW WALK." |
| 8 | THE UNSHAKEN | streak ≥ 7 | "{streak} DAYS WITHOUT SILENCE." |
| 9 | KEEPER OF THE LEDGER | default (≥ 5 rounds) | "THE LEDGER GROWS. SO DO YOU." |

Rules use only data the API already stores (predictions, outcomes, crowd
percentages, streak). Epithet + stats come from one new endpoint:

`GET /v1/me/ledger` → `{ oracle_score, days_consulted, streak, accuracy_pct,
avg_confidence, tide_wins, majority_rate, epithet: { id, title, receipt },
computed_through: date }` — computed on read (v1; cached later if hot), zod
schema in @oracle/core, epithet assignment implemented as a pure TDD'd
function in core so mobile and API share it.

**Share:** the plaque gets its own night-realm share card (reuses ShareCard's
anatomy: midnight ground, orb, PatinaHalo, epithet in Cinzel, receipt + stats
in mono, liturgy footer). Epithet changes are the shareable moment; the weekly
recompute is what makes identity a living thing — same reason horoscopes are
weekly, not eternal.

**Hook only (not specced):** Plus cosmetics — alternate plaque materials
(marble, midnight), epithet history.

## 7. Failure handling

- No results at noon (resolution late): generic noon line, never a false claim.
- New device / no history: plaque renders THE UNREAD honestly; no empty-state
  apology copy — the machine voice does not apologize.
- OneSignal unreachable at cron: skip the beat silently; never queue a stale
  "THE LEDGER IS READ" for later delivery (a 6pm noon-push is a broken ritual).
- Push permission denied: all beats silently skip; in-app surfaces carry the
  same lines so the voice exists without pushes.

## 8. Testing

- `packages/core`: copy-lint suite (§3), epithet assignment (TDD: each rule's
  boundary, priority order, receipt slot filling), line-selection determinism.
- `apps/api`: `/v1/me/ledger` (TDD, makeTestDb): stat math incl. void
  exclusion, majority-rate against crowd data, 28-day window edges.
- Push composition: pure function (line pool → segment payloads) unit-tested;
  the OneSignal HTTP call itself is thin and hand-verified in staging.
- Mobile: plaque renders from a fixture payload; hand-test the permission
  interstitial flow on device.

## 9. Build order (within Plan 3)

1. Copy bank + lint + liturgy placements (S — no infra dependencies)
2. `/v1/me/ledger` + epithet core (M — needs streak fields from Plan 3's
   streak work)
3. Plaque screen + plaque share card (M)
4. OneSignal integration + two-beat cron + permission interstitial (M — last,
   so real copy and real ledger data exist before the first push ever fires)
