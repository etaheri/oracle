// Palette from the brand brief (docs/superpowers/specs/2026-08-26-oracle-brand-brief.md §7):
// museum grounds, ink typography, sleeve accents, midnight contrast. Contrast
// ratios noted are against museumWhite.
export const colors = {
  museumWhite: "#F7F6F2", // primary ground — the museum field
  museumWhiteClear: "rgba(247,246,242,0)", // the same ground at zero alpha — the far end of a fade INTO the ground, so a gradient never has to spell the colour out at a call site
  frescoWhite: "#F3F0E9", // card face — the artifact on the museum wall
  ink: "#17191F", // primary text (16.3:1)
  mutedInk: "#666A73", // secondary text, captions, chrome (5.0:1)
  agedGold: "#AA8A50", // gilt — borders, fills, large display only; fails AA as small text
  goldText: "#7E6538", // text-tier aged gold (5.1:1) — derived; brief has no small-text gold
  ultramarine: "#243D78", // YES — the blue sleeve (9.6:1)
  vermilion: "#A84B35", // NO, losses — the red sleeve (5.2:1)
  midnightMuseum: "#121A2B", // night realm: the share card
  glassBlue: "#9CB5D1", // decorative — orb rim, halos; never text on light
  lavender: "#B7A9E4", // decorative — orb atmosphere, glow; never text on light
  warmCenter: "#F2BE91", // decorative — orb center; text-tier on midnight (10.4:1)
  line: "rgba(23,25,31,0.16)",
  lineSoft: "rgba(23,25,31,0.08)",
  mark: "rgba(23,25,31,0.30)", // register marks — a glyph reads lighter than a rule, so it sits a step above `line`
  goldWash: "rgba(170,138,80,0.10)",
  ultramarineWash: "rgba(36,61,120,0.06)",
  vermilionWash: "rgba(168,75,53,0.06)",
} as const;

// Two voices (design spec §3b, narrowed by brief §7 "card = artifact" ruling):
// the machine voice (IBM Plex Mono) owns all chrome; the temple voice
// (Marcellus display, Cinzel carved caps) survives only in the wordmark, the
// card numerals, day points, and the card/share artifacts themselves.
export const fonts = {
  display: "Marcellus",
  ritual: "Cinzel",
  ritualBold: "Cinzel-SemiBold",
  mono: "IBMPlexMono",
  monoMedium: "IBMPlexMono-Medium",
};

export const space = (n: number) => n * 4;

// The machine voice runs on five roles. Size, tracking, and line box live here
// — not at the call site — so "10 or 11, tracking 2 or 3" stops being a
// decision each screen makes for itself. Colour, not metrics, carries meaning:
// `line` in gold is the oracle's state, `line` in muted ink is navigation.
export const typeScale = {
  eyebrow: { size: 10, letterSpacing: 4 }, // the screen's stamp
  meta: { size: 10, letterSpacing: 2 }, // passive chrome: countdowns, notices
  line: { size: 11, letterSpacing: 2 }, // one row of machine speech
  action: { size: 12, letterSpacing: 3 }, // framed buttons
  body: { size: 12, letterSpacing: 0.5 }, // long-form text
  clock: { size: 16, letterSpacing: 4 }, // the live time under the wordmark
} as const;

// Explicit line boxes, so a row's height is a constant we can reserve space
// for rather than a font-metric surprise. Lines that arrive late (the notice,
// the countdown) hold their slot from the first frame and never shove the
// composition when they land.
export const ROW_H = { meta: 14, line: 16, body: 20, clock: 22 } as const;

// A tracked run of text carries its tracking after the last glyph too, which
// pushes centred text left by one step. Cancel it at the tail.
export const trackTail = (letterSpacing: number) => ({ marginRight: -letterSpacing });
