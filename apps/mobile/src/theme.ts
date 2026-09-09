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
  unwritten: "rgba(23,25,31,0.22)", // a numeral for a slot not yet sealed: present, not yet spoken for
  scrim: "rgba(247,246,242,0.72)", // museum white at reading-header weight — the ground, thinned, over scrolling content
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
  action: { size: 12, letterSpacing: 3 },
  supporting: { size: 11, letterSpacing: 0.5 }, // the reading register at CHROME scale — a gloss inside a dense plaque or card
  caption: { size: 10, letterSpacing: 1 }, // secondary reading text // framed buttons
  body: { size: 12, letterSpacing: 0.5 }, // long-form text
  // The reading register. Chrome is recognised, not read: it is tracked 2-4 so
  // a glance resolves it as a token. Explanation is READ, and tracking is what
  // makes reading slow -- so the one role a player actually reads sentence by
  // sentence is set close to zero, a step larger than body, with a line box
  // generous enough for wrapped claims. This is the human half of the page;
  // `line` and `eyebrow` are the machine half.
  reading: { size: 14, letterSpacing: 0.2 }, // the reading register at PAGE scale — rules, definitions, anything a screen is FOR
  // `supporting` and `reading` are one register at two scales: what makes
  // them the reading voice is the near-zero tracking and the sentence case,
  // not the size. Pick by surface — a page of rules reads at 14, the same
  // sentence glossing a stat row inside the plaque reads at 11, and both stay
  // visibly a different voice from the tracked caps around them.
  clock: { size: 16, letterSpacing: 4 }, // the live time under the wordmark
} as const;

// The temple voice's scale.
//
// The machine voice has had five argued roles since theme.ts existed; the
// scarcer, more ceremonial half had none, and was hand-set at thirteen
// different sizes across twenty-six call sites — 22 six times, 20 three
// times, with no principle separating them. That is not scarcity, it is
// thirteen individual decisions.
//
// Six steps, named for what they are set on rather than how big they are.
// `points` is deliberately off the progression: the day's number is the one
// figure in the app allowed to be a spectacle.
export const displayScale = {
  slot: 13,     // a numeral marking a row, and the labels that sit beside one
  inline: 16,   // a question read inside a row or a card's result face
  stamp: 18,    // the carved numeral at the head of a card or a rite
  lead: 22,     // a card's own question; a plaque's earned figure
  epithet: 26,  // the one carved phrase a screen is built around
  points: 54,   // the day's score
} as const;

// Explicit line boxes, so a row's height is a constant we can reserve space
// for rather than a font-metric surprise. Lines that arrive late (the notice,
// the countdown) hold their slot from the first frame and never shove the
// composition when they land.
export const ROW_H = { meta: 14, line: 16, body: 20, supporting: 18, caption: 16, action: 18, clock: 22, reading: 22 } as const;

// A tracked run of text carries its tracking after the last glyph too, which
// pushes centred text left by one step. Cancel it at the tail.
export const trackTail = (letterSpacing: number) => ({ marginRight: -letterSpacing });
