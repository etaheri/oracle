# ORACLE mobile — design audit (impeccable:audit)

**Date:** 2026-08-20 · **Scope:** `apps/mobile` UI vs. the "digital antiquity" spec (§3b of `2026-08-09-oracle-design.md`) and the Co-Star reference (modern restraint × classical iconography).

## Anti-Patterns Verdict

**Passes the AI-slop test structurally, fails the distinctiveness test on assets.** There are zero 2024–25 AI tells: no purple gradients, no glassmorphism (expo-glass-effect is installed but unused), no card grids, no hero-metric template, no cyan-on-dark. The obsidian/gold/serif-×-mono system is a real point of view. The problem is the opposite failure mode: the app currently looks like a **wireframe of its own spec**. The temple voice (classical art, carved-caps serif) exists nowhere; the machine voice is rendered in system Didot/Menlo instead of the spec'd faces; the two signature Skia shaders don't exist; the app icon is the stock Expo blue chevron. Nothing here would make someone ask "how did they do that?" — yet the spec explicitly designs for that question.

## Executive Summary

- **14 issues: 3 Critical, 5 High, 4 Medium, 2 Low.**
- Top critical: (1) stock Expo store identity shipping in app.json/assets, (2) brand typography not implemented (Didot/Menlo fallbacks; Android gets generic serif/mono), (3) VoiceOver users cannot operate the confidence slider — the core game mechanic.
- The single highest-leverage move for the user's stated goal ("lean into Skia + classical imagery, Co-Star energy") is **Plan 3's font + Skia work, sequenced fonts-first**: Cinzel/Marcellus/Plex Mono changes every screen for one afternoon of work; the grain + gold-shimmer shaders then make the whole surface feel like an object instead of a screen.

## Critical

### C1 — Stock Expo identity in shipping config
- **Location:** `apps/mobile/app.json`, `assets/images/*`
- **Category:** Theming / Brand
- **Description:** App name and slug are `"mobile"`, scheme is `"mobile"`, icon.png is the Expo template blue chevron, Android adaptive-icon background is `#E6F4FE` (template light blue — maximally off-palette), splash icon is the template mark.
- **Impact:** This is what App Review, TestFlight friends, and the Shipaton judges see first. The blue chevron on a home screen destroys the "instantly distinctive" strategic aim before the app is even opened. Also `scheme: "mobile"` is the deep-link scheme share cards will use — changing it after launch breaks links.
- **Recommendation:** Set name `ORACLE`, slug/scheme `oracle`, obsidian `#0C0A07` adaptive background, and a text-orb-motif icon (the spec's own thumbnail-scale motif). Do this before the App Review submission, not after.
- **Command:** `/normalize` (align config to tokens), then icon art as part of the Skia text-orb work.

### C2 — Brand typography not implemented
- **Location:** `apps/mobile/src/theme.ts:17-20`
- **Category:** Theming / Typography
- **Description:** `fonts.serif` is iOS system **Didot** falling back to generic `serif` on Android; `fonts.mono` is **Menlo**/`monospace`. The spec's identity is Marcellus + Cinzel (temple) + IBM Plex Mono (machine), all OFL and repo-committable; `expo-font` is already installed and unused; Arizona Flare trials sit in `design/fonts/trial/`.
- **Impact:** Didot is fashion-magazine French modern, not Trajan-class carved antiquity — it actively says the wrong thing. On Android the entire identity collapses to Roboto-serif/monospace. Typography is ~90% of this design system's visible surface; this is the cheapest, largest brand win available.
- **Recommendation:** Load Cinzel (carved-caps ritual: eyebrows, buttons, ORACLE wordmark), Marcellus (question text, display), IBM Plex Mono (machine chrome) via `expo-font` in `_layout.tsx` behind the splash screen. Keep the `fonts` token indirection — it makes the Arizona Flare swap a one-line change later.
- **Command:** `/typeset`

### C3 — Confidence slider is inoperable with VoiceOver
- **Location:** `apps/mobile/src/ui/ConfidenceSlider.tsx:39-41`
- **Category:** Accessibility
- **Description:** The slider declares `accessibilityRole="adjustable"` but implements no `accessibilityActions`/`onAccessibilityAction` for increment/decrement; the only input path is a `PanResponder` drag.
- **Impact:** A screen-reader user can hear the confidence value but cannot change it — and confidence is the game. WCAG 2.1.1 (Operable) failure on the core mechanic.
- **Recommendation:** Add `accessibilityActions={[{name:"increment"},{name:"decrement"}]}` and step by 5 in `onAccessibilityAction`. ~8 lines.
- **Command:** `/harden`

## High

### H1 — The Skia layer doesn't exist yet
- **Location:** `apps/mobile/package.json` (no `@shopify/react-native-skia`)
- **Category:** Brand / Visual details
- **Description:** No film-grain/aged-paper overlay, no gold-leaf shimmer, no generative text-orb, no `makeImageSnapshot` share-card path. These are the spec's only two signature shaders plus the marketing motif and the **viral engine** (share card).
- **Impact:** Without grain, obsidian reads as flat #hex darkness — a screen, not an object. Without the share card there is no share loop, which the whole traction thesis rides on. This is planned for Plan 3; the audit's contribution is sequencing: **share card > grain > shimmer > orb**, because the share card is a growth mechanic and the others are polish.
- **Recommendation:** Keep the spec's own discipline — two shaders, reused everywhere, timeboxed. Grain as a single full-screen `Canvas` overlay in `Screen.tsx` (one component, every screen inherits it); shimmer as a Reanimated-driven uniform on the Big One border and GoldButton.
- **Command:** `/overdrive` for the shaders + orb; the share card is Plan 3 feature work.

### H2 — The temple voice is absent; reveals have no ceremony
- **Location:** `src/app/reveal/[date].tsx`, `src/ui/CrowdReveal.tsx`
- **Category:** Brand / Motion
- **Description:** The spec mandates two voices; only the machine voice exists. The next-day ledger — dopamine hit #2, spec'd as "performed with ceremony, not buried in a list" — is a static list: rows render instantly, the day-points number just appears, the Big One is a bordered box. No classical art (the sibyls, Waterhouse), no Cinzel moment, no staggered reveal, no boot sequence anywhere.
- **Impact:** The reveal is the retention moment. Co-Star's daily open works because the day's reading is staged like an event; ORACLE's equivalent currently reads like a receipt printed before you looked at it. (The receipt *aesthetic* is right — the *instant* delivery is wrong.)
- **Recommendation:** Ordered choreography with Reanimated: eyebrow → receipt rows type in one by one (mono, ~80ms stagger) → day-points number lands last with a haptic → Big One block enters as the temple moment (Cinzel caps, gold shimmer, and this is the one place a public-domain artwork can sit — *behind the frame, never behind body text*, per spec). Reserve full art moments for title promotions so scarcity keeps it sacred.
- **Command:** `/animate` + `/delight`

### H3 — Oxblood text fails contrast on error and loss states
- **Location:** `src/ui/QuestionCard.tsx:47`, `src/app/reveal/[date].tsx:30,37,58` (`colors.oxblood` as text)
- **Category:** Accessibility
- **Description:** `#B04A38` on obsidian `#0C0A07` ≈ **3.7:1**, below WCAG AA 4.5:1 — and it's used at 11–12px for error messages and negative points, the highest-stakes copy in the app.
- **Impact:** Losses and failures are the hardest text to read. (Ash `#8D8677` ≈ 5.5:1 passes; gold ≈ 7+:1 passes — oxblood is the only failing token.)
- **Recommendation:** Add an `oxbloodBright` text-tier token (~`#D9705A`-range, ≥4.5:1) and reserve `#B04A38` for borders/fills/large display numerals (the 54pt day-points serif is fine as-is).
- **Command:** `/normalize`

### H4 — Touch targets below 44px on the most-tapped controls
- **Location:** `src/ui/QuestionCard.tsx:39-44` (YES/NO ≈ 34px tall), `src/ui/Button.tsx` (GoldButton ≈ 38px)
- **Category:** Accessibility / Responsive
- **Description:** YES/NO pressables: `paddingVertical: space(2.5)` (10px) + ~14px text ≈ 34px. GoldButton ≈ 38px. Both under the 44px minimum. YES/NO also lacks `accessibilityState={{ selected }}`, so VoiceOver never announces which side is chosen.
- **Impact:** These are tapped five-plus times per daily round; mis-taps on a YES/NO commit game are costly. Missing selected-state is a WCAG 4.1.2 gap.
- **Recommendation:** `paddingVertical: space(3.5)` on YES/NO, `space(4)` on GoldButton (or `hitSlop`), add `accessibilityState`.
- **Command:** `/harden`

### H5 — Question text truncated at the reveal
- **Location:** `src/ui/CrowdReveal.tsx:38`, `src/app/reveal/[date].tsx:41` (`numberOfLines={1}`)
- **Category:** Harden / UX
- **Description:** Crowd reveal (dopamine hit #1) and ledger rows clamp question text to one line. Real questions ("Will the Fed hold rates at the Sept meeting per…") will clip mid-clause.
- **Impact:** The player is looking at a crowd split for a question they can't read. Gets worse with any Dynamic Type scaling.
- **Recommendation:** Allow 2 lines in CrowdReveal; in the ledger keep 1 line but make rows expandable, or restate only the short question stem.
- **Command:** `/harden`

## Medium

### M1 — Home screen: centered stack, three identical primary buttons
- **Location:** `src/app/index.tsx`
- **Category:** Layout / Hierarchy
- **Description:** Everything is center-aligned in one vertical stack with uniform gaps, and ENTER / BEHOLD THE CROWD / YESTERDAY'S LEDGER are all the same GoldButton. Two named anti-patterns: center-everything, every-button-primary.
- **Impact:** The summons — the spec's "live-feeling event" — has the energy of a settings menu. Co-Star's restraint works because of extreme scale contrast (giant display type, tiny captions, vast space), not uniform smallness.
- **Recommendation:** One primary action per state (ENTER gets the gold border; YESTERDAY'S LEDGER becomes a quiet mono text-link at the bottom edge). Push the wordmark much larger in Cinzel once fonts land; let the quote sit asymmetrically. This screen is also the natural home for the Skia text-orb.
- **Command:** `/bolder` + `/arrange`

### M2 — `SafeAreaView` from react-native
- **Location:** `src/ui/Screen.tsx:1`
- **Category:** Responsive
- **Description:** RN's `SafeAreaView` is iOS-only; `react-native-safe-area-context` is installed but unused. On Android content can sit under the status bar/notch.
- **Recommendation:** Swap to `SafeAreaView` (or `useSafeAreaInsets`) from `react-native-safe-area-context` — also the natural place to mount the future grain overlay.
- **Command:** `/harden`

### M3 — Crowd bar animates layout width
- **Location:** `src/ui/CrowdReveal.tsx:10-19`
- **Category:** Performance / Motion
- **Description:** `Bar` animates percentage `width`. Also `withTiming` default easing (bezier inOut) rather than the decisive ease-out the rest of the ritual should share, and no reduced-motion handling.
- **Recommendation:** Animate `transform: [{ scaleX }]` with `transformOrigin` left, easing `Easing.out(Easing.quart)`, ~600ms; respect `useReducedMotion()` from Reanimated. Establish this as *the* house easing before Plan 3 multiplies the animation count.
- **Command:** `/animate`

### M4 — Config drift: `userInterfaceStyle: "automatic"`, dead template deps
- **Location:** `app.json`, `package.json`
- **Category:** Theming / Performance
- **Description:** The app is permanently obsidian but declares `automatic`, so system sheets/keyboards can flash light-mode. Template deps (`@expo/ui`, `expo-glass-effect`, `expo-image`, `expo-symbols`, `expo-web-browser`, `expo-device`, `expo-status-bar`, `expo-system-ui`, `react-native-gesture-handler`) ship unused — already flagged in the Plan 2 follow-ups.
- **Recommendation:** `userInterfaceStyle: "dark"`; prune per the follow-ups list (keep `expo-font`; reconsider keeping `react-native-gesture-handler` if the slider moves off PanResponder).
- **Command:** `/normalize`

## Low

- **L1 — `letterSpacing: 12` on the ORACLE wordmark** (`index.tsx:30`): RN letter-spacing adds a trailing space after the final glyph, so the centered wordmark sits visually left-shifted. Wrap with `marginRight: -12` or pad left. `/polish`
- **L2 — `const [, force] = useState(0)` re-render hack** (`round.tsx:14`): `markSealed` already updates the zustand `answers` selector, which re-renders the subscriber; the manual force is redundant. Also the slider's `PanResponder` runs on the JS thread — fine today, but a candidate for gesture-handler when Plan 3 raises the motion bar. `/polish`

## Patterns & Systemic Issues

1. **Single-voice syndrome.** Every screen is machine voice; the temple voice has zero pixels. The dual-voice architecture is the identity — until one Cinzel/art moment exists, the app is a terminal theme, not "digital antiquity."
2. **The identity lives in tokens but not in assets.** Palette discipline is excellent (everything routes through `theme.ts`); fonts, icon, shaders, and art — the things tokens can't fake — are all placeholders.
3. **Ceremony deficit.** Both dopamine hits render instantly and statically. The spec's event-drop psychology depends on staging.
4. **Sub-44px targets and missing a11y state** recur across every custom pressable — fix as one pass.

## Positive Findings

- **The palette is genuinely good.** Obsidian is tinted warm (not #000), bone is tinted (not #fff), gold carries hierarchy, lines are gold-alpha rather than gray. No AI palette anywhere.
- **Copy is the strongest asset in the build.** "SEAL THE PROPHECY," "THE CONNECTION WAVERS — TRY AGAIN," "THE LEDGER IS READ AT NOON," the ✶/∅ glyphs — mystic-playful, machine-voiced, zero filler. Protect this voice in review.
- **Receipt aesthetic on the ledger** (baseline-aligned mono rows, ✓/✗/∅, dashed separators) is exactly the Palantir-poster DNA the spec asked for.
- **Trust-as-UI shipped:** `resolves per {source}` prints on every card.
- **Haptics on commitment moments** (seal, slider detents) are already in — rare at this stage.
- **Sharp corners everywhere.** No default rounded-rectangle-with-drop-shadow anywhere; the 1px gold-line frame system is cohesive.

## Recommendations by Priority

1. **Immediate (this week, pre-App-Review):** C1 store identity, C2 fonts, C3 slider a11y, H3 oxblood contrast, H4 touch targets. All are hours, not days.
2. **Short-term (Plan 3 core):** H1 Skia — share card first, then grain overlay in `Screen`, then gold shimmer; H2 reveal choreography + first temple moment; H5 truncation.
3. **Medium-term:** M1 home-screen hierarchy + text-orb, M2–M4 config/motion cleanup, boot micro-sequence.
4. **Long-term (traction-gated, per spec):** Arizona Flare license swap, sibyl title-ladder art, Grand Oracle surfaces.

## Suggested Commands

| Command | Addresses |
|---|---|
| `/typeset` | C2 — Cinzel/Marcellus/Plex Mono via expo-font |
| `/harden` | C3, H4, H5, M2 — a11y actions, targets, truncation, safe areas |
| `/normalize` | C1, H3, M4 — app.json, oxblood text tier, dead deps |
| `/overdrive` | H1 — grain + shimmer shaders, generative text-orb |
| `/animate` + `/delight` | H2, M3 — reveal ceremony, house easing, micro-boot |
| `/bolder` + `/arrange` | M1 — summons screen scale contrast and hierarchy |
