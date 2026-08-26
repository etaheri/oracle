// Palette from the brand brief (docs/superpowers/specs/2026-08-26-oracle-brand-brief.md §7):
// museum grounds, ink typography, sleeve accents, midnight contrast. Contrast
// ratios noted are against museumWhite.
export const colors = {
  museumWhite: "#F7F6F2", // primary ground — the museum field
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
