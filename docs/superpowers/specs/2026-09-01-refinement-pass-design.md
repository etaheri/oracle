# Refinement Pass — Design Spec

> Audit delivered 2026-09-01. Source: full read of `apps/mobile/src` against
> the brand brief (`2026-08-26-oracle-brand-brief.md`). This spec records the
> findings and the rulings; the plan
> (`docs/superpowers/plans/2026-09-01-refinement-pass.md`) implements it.

## Goal

Raise every screen to the standard already set by Home and the Card, so the
app reads as one designed object in a still frame — the bar for being
spotted in production and catalogued on Mobbin.

## Verdict on the existing work

The app passes the AI-slop test decisively: no gradient text, no
glassmorphism, no cyan-on-dark, no rounded-rect-with-drop-shadow, no hero
metric template. `src/theme.ts` carries a genuine type system — five
machine-voice roles with metrics in the scale rather than at call sites, and
explicit line boxes (`ROW_H`, `CALL_SLOT_H`, `CLOCK_H`) so late-arriving rows
never shove the composition.

**The gap is not quality, it is evenness.** Home and the Card are finished
objects. Reveal, Rites, Plus, Summons, and CrowdReveal are placeholders
wearing the right fonts. A Mobbin flow is only as good as its weakest frame.

---

## 1. The card: no literal ASCII, more machine information

**Ruling: reject box-drawing characters.** `┌───┐` is the most common
terminal-aesthetic cliché, it fights the tarot proportion (`DECK_RATIO =
0.7`), and it breaks at every width. Brief §4 governs: *"ASCII should be
discovered as a detail, not dominate"*; brief §7 asks for *"very restrained
borders."* The register marks in `CardChrome.tsx` are already the correct
idiom — antique card printing × technical drawing.

The real deficiency is that the card carries **one** terminal detail (the
coordinate) on a 70%-ratio surface, and **never says it is ticking**. The
countdown lives only on Home.

### 1.1 Register marks become glyphs

The four corner marks are currently eight `<View>` rectangles. Render a mono
`+` at each corner of the inset rule instead. Identical silhouette; the frame
joins the machine's alphabet rather than sitting outside it as drawn
furniture.

### 1.2 Status field

Bottom-right, optically symmetric with the bottom-left coordinate. Three
states, in machine voice:

- open, round lock known → `LOCK 04:12:09` (live, ticking, 1s cadence)
- open, no lock known → `ST: OPEN`
- sealed → `ST: SEALED`

This is what makes a still screenshot look alive, and it is the single
highest-leverage change in this spec.

### 1.3 Title splits into category and modifiers

`CardChrome`'s `title` currently absorbs the category *and* the Big One's
modifiers in one long string (`✶ The Big One · pays double · costs double`),
which wraps badly at `letterSpacing: 4`. Split it:

- `title` — the category alone, bracketed: `[ POLITICS ]`. Brackets are the
  app's best terminal signature and currently appear in exactly one place
  (`FooterNav`). Repeat the idiom.
- `modifiers` — an optional second, smaller, muted mono line:
  `PAYS DOUBLE · COSTS DOUBLE · CLOSES EARLY`.

On an undealt card the title is `decodeFrame` static; the brackets stay solid
while their contents are noise, which is the correct reading.

### 1.4 The stack shows its static

`UndealtCard` renders full `decodeFrame` noise — a beautiful detail nobody
sees, because `STACK_TOP_Y = 9` hides it under the live card. Raise the
offset so a band of static is visible at rest.

---

## 2. Reveal is the payoff and the weakest surface

`reveal/[date].tsx` renders four rows of `flexDirection: "row"` +
`borderBottomWidth: 1`, question text at `Mono size={11}`, receipt at
`size={9}`. That is a settings list. It is also the app's emotional climax
(the day being judged) and its most-shared screenshot.

**Give the ledger the card's vocabulary:**

- Slot numerals down the left (`numeral()`, `Ritual`, gold when won) instead
  of the `✓ / ✗` glyph marks — the same numerals the card and the round's
  progress row already use.
- The question in `Serif` — it is a prophecy, not a log line.
- The receipt in mono as the clearly subordinate voice.
- Hairlines between groups, not under every row.
- Outcome value stays right-aligned in mono, gold or vermilion.

The Big One already gets a `GoldFrame`. The four ordinary rows must read as
part of the same document.

---

## 3. Two native alerts break the voice completely

`ledger.tsx` uses `Alert.alert()` for the identity collision and for striking
the record — SF Pro in a rounded iOS system dialog, buttons reading CANCEL
and STRIKE. This is the loudest tonal break in the app, and it lands on the
two most dramatic moments in it.

Build a `RiteConfirm` surface: museum ground, framed like the card,
`GoldButton` to confirm, `QuietLink` to withdraw, vermilion for destructive
confirmation. Replace both alerts.

---

## 4. No Dynamic Type support; thirteen instances of ≤9px type

Every size is a hardcoded number. No `allowFontScaling` handling, no
`maxFontSizeMultiplier`, no `fontScale` read. At accessibility text sizes the
fixed line boxes that make Home's layout stable will overflow or clip.

**Ruling: cap, do not go fluid.** Full fluid type would dissolve the
no-shift choreography, which is among the best-engineered things in the app.

- `maxFontSizeMultiplier: 1.3` on chrome roles (`eyebrow`, `meta`, `line`,
  `action`, `clock`).
- `Serif` question text scales freely — it is the content.
- `ROW_H` and the derived slot heights read `PixelRatio.getFontScale()` so
  reserved space grows with the cap.
- Nothing below 10px that a user is expected to read.

---

## 5. CrowdReveal is a finale with no frame

`CrowdReveal.tsx` resolves five sealed cards into an unframed vertical stack
of muted `Serif 15` + gauge + two mono lines. The screen before it was a
gilded artifact. It is titled "The crowd is revealed" and does not feel like
a revelation. It wants the `frescoWhite` ground and a frame — it is the
second artifact in the app's story and the only one with no edges.

---

## 6. Rites, Plus and Summons are the same screen three times

Identical composition in all three: `<Eyebrow>` → centred `DecodeLine` stack
→ `GoldButton` at the foot. In a Mobbin flow they read as one screen shown
thrice, and they are three of seven.

Differentiate by **structure**, not decoration:

- **Rites** — these are rules. Number them in `Ritual` numerals, matching
  the card slots. A numbered liturgy, left-aligned.
- **Plus** — this is a comparison. The price rows are the content and are
  currently buried below a centred creed; lift them and let the creed become
  supporting text.
- **Summons** — this is a single question. Nearly empty: one line, one
  button, enormous negative space.

---

## 7. Minor findings

- `plus.tsx` ships `PRIVACY_URL = "https://PRIVACY_URL_TBD_TASK_12"` as a
  live tappable link. App Store blocker.
- `catch {}` swallows share failures in `reveal/[date].tsx` and
  `ledger.tsx` — a failed share does nothing at all. Every other error in
  this app has a written line.
- Ledger stats (`ledger.tsx`) are seven rows of identical size, weight and
  colour. `ORACLE SCORE` is the headline and is indistinguishable from
  `SHIELDS IN RESERVE`.
- No pull-to-refresh anywhere, on a daily-ritual app with a fixed drop time.
- Reveal's `ScrollView` gives no signal that content continues below the
  fold, where the Big One and the share button live.
- `GoldButton` has one pressed state shared by `ENTER`, `SHARE THE PROPHECY`
  and `STRIKE`. A destructive action must not press like an invitation.
- Loading states take over the whole screen; on the ledger this means the
  plaque's frame vanishes and returns, which reads as a flash rather than a
  fill.

---

## Constraints

- Brand brief is authoritative. Museum-white ground, ink type, restrained
  borders, ASCII as discovered detail, no terminal green, no neon.
- Reduced motion must be honoured by every new animation.
- ASCII stays decorative and never carries meaning alone (brief §11).
- Touch targets stay ≥44pt.
- Expo SDK 57 — consult https://docs.expo.dev/versions/v57.0.0/ before
  writing code (repo `AGENTS.md`).
- Pure logic lives in `src/game/` with vitest coverage; components are
  verified by `pnpm typecheck` and manual run. Do not introduce a component
  test framework.
