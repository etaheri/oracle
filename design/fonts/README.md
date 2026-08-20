# Fonts

## Trial fonts (`trial/` — gitignored, local only)

`trial/` holds **ABC Arizona Unlicensed Trial** files from Dinamo (Flare Light/Regular/Medium/Bold + the Superfamily Variable). Rules:

- **Mockups and local design exploration only.** They must never be bundled into a store build, an EAS build, TestFlight, the marketing site, or any published artifact.
- The directory is gitignored — trial EULAs don't permit redistribution, so they stay out of the repo entirely. Re-download from abcdinamo.com if missing.
- The Superfamily Variable file is for prototyping the sans↔serif axis-morph (open in Figma / fontgauntlet.com) to decide whether the variable license is worth the upcharge.

## Licensed fonts (when purchased)

On purchase of the Dinamo App/Game (+ Web) license, licensed OTFs replace the trials:

- App: `apps/mobile/assets/fonts/` via `expo-font` config plugin — same PostScript-name slots, one-line swap.
- Licensed files also stay gitignored unless the license explicitly permits repo storage; CI injects them via EAS secrets/file env if needed.

## Machine voice

IBM Plex Mono (OFL) — bundled normally in `apps/mobile/assets/fonts/`, no restrictions.

## Deadline fallback (no license in time)

Marcellus + Cinzel (Google Fonts, OFL) split the temple voice — see tech spec §2.
