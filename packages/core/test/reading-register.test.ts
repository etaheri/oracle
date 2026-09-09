import { describe, it, expect } from "vitest";
import { INTRO_LINES, PLUS_CREED_LINES, RITES_V2_SECTIONS, SCORE_GLOSS } from "../src/copy";

// The other half of the copy lint.
//
// copy-lint.test.ts governs the MACHINE voice — the bank, the summons, the
// calling, the CTA labels — and holds every one of them to tracked caps,
// because those lines are recognised at a glance rather than read. Nothing
// held the reading voice to anything, so the register split existed in
// theme.ts and in the type roles but not in the copy, and whichever screen
// was written last decided which voice the rules were in.
//
// This is that missing rule. A line in here is a line a player READS —
// sentence by sentence — so it is set in sentence case, and its emphasis
// comes from the defined-term pass rather than from shouting in the source.

const READING = [
  ...INTRO_LINES.map((text, i) => ({ id: `intro-${i + 1}`, text })),
  ...RITES_V2_SECTIONS.flatMap((s) => s.claims.map((text, i) => ({ id: `${s.title}-${i + 1}`, text }))),
  // A gloss is a sentence explaining the stat above it — the definition of
  // reading copy. The plaque proved the point by carrying two of them eight
  // rows apart, the vigil's in sentence case and the rating's in tracked
  // caps, doing the same job on the same surface in opposite voices.
  ...Object.entries(SCORE_GLOSS).map(([id, text]) => ({ id: `score-gloss.${id}`, text })),
  // The argument for spending money — four paragraphs a player is expected to
  // weigh. It lived in the ambient copy bank, which holds every line to
  // tracked caps because the bank exists for lines the machine says in
  // passing. Rendered through role.supporting it was the least readable
  // register available, on the most consequential screen in the app.
  ...PLUS_CREED_LINES.map((text, i) => ({ id: `creed-${i + 1}`, text })),
];

// The machine's own tokens, which stay capitalised inside a read sentence
// because they are names rather than emphasis.
const ACRONYMS = ["AI", "YES", "NO"];

describe("the reading register", () => {
  it("covers the rules a first-time player is actually shown", () => {
    // A guard on the guard: if INTRO_LINES stops being reading copy this test
    // should be deleted deliberately, not quietly emptied.
    expect(INTRO_LINES.length).toBeGreaterThan(0);
    expect(READING.length).toBeGreaterThan(20);
  });

  it("is written to be read, not recognised", () => {
    for (const { id, text } of READING) {
      expect(text, `${id}: reading copy must not be shouted`).not.toBe(text.toUpperCase());
      // Opens with a capital. Whether the REST is sentence case is the next
      // test's job — a one-letter opener ("A correct call…") is still prose.
      expect(text, `${id}: a read sentence opens with a capital`).toMatch(/^[A-Z]/);
    }
  });

  it("leaves emphasis to the defined terms, never to caps in the source", () => {
    // `Term` in ui/Text.tsx uppercases a defined term at render. A claim that
    // also hardcodes the caps encodes the same intent twice, and the two drift:
    // "The DAILY BOARD ranks players." beside "THE CROWD shows which way they
    // lean." is one rite disagreeing with itself about the article.
    for (const { id, text } of READING) {
      const shouted = (text.match(/\b[A-Z]{2,}\b/g) ?? []).filter((w) => !ACRONYMS.includes(w));
      expect(shouted, `${id}: let emphasizeClaims apply the caps`).toEqual([]);
    }
  });

  it("teaches the gesture that sets confidence", () => {
    // The one line the whole app turns on. It lived only in the reference
    // rites, which is the screen a first-time player does not open.
    const intro = INTRO_LINES.join(" ").toLowerCase();
    expect(intro, "the opening rites must say how a call is made").toContain("pull");
    expect(intro, "the opening rites must say how a call is committed").toContain("release");
  });
});

describe("defined terms are named without their article", () => {
  it("never carries a leading article into the term", () => {
    // "the crowd" marks the article; "daily board" does not. One rite then
    // renders "The DAILY BOARD ranks players." above "THE CROWD shows which
    // way they lean." — the emphasis starts in a different place each time.
    for (const section of RITES_V2_SECTIONS) {
      for (const term of section.defines) {
        expect(term, `${section.title}: "${term}"`).not.toMatch(/^(the|a|an)\s/i);
      }
    }
  });
});
