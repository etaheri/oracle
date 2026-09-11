import { describe, it, expect } from "vitest";
import {
  COPY_BANK, INTRO_LINES, RITES_V2_SECTIONS, RITES_V2_ARCHIVE_SECTIONS, PLUS_CREED_LINES, SCORE_GLOSS, SUMMONS_LINES, CALLING_LINES,
  PARTIAL_LINE, READING_LINES, PIPELINE_LINES, PAYWALL_CTA_LINES, REMINDER_CTA_LINES, PUSH_CAMPAIGN_LINES, LITURGY_LINES,
} from "../src/copy";
import { GAME_TERMS, CURRENT_GAME_COPY } from "../src/gameCopy";

// The vocabulary cut (design 2026-09-10 §8.1, D12). The first playtest called
// the rules confusing and the metaphors a lot to manage; these words are
// retired from everything a player reads. The archived version 1 canon
// (RITES_LINES) keeps them because it is history, and is not scanned here.
export const RETIRED = /\b(vigils?|shields?|exhibitions?|rites?|ledgers?|crowds?|conviction|epithets?|oracle rating)\b/i;

const SURFACE: Array<{ id: string; text: string }> = [
  ...COPY_BANK.map((l) => ({ id: l.id, text: l.text })),
  ...INTRO_LINES.map((text, i) => ({ id: `intro-${i + 1}`, text })),
  ...RITES_V2_SECTIONS.flatMap((s) => [{ id: `${s.title}:title`, text: s.title }, ...s.claims.map((text, i) => ({ id: `${s.title}-${i + 1}`, text }))]),
  ...PLUS_CREED_LINES.map((text, i) => ({ id: `creed-${i + 1}`, text })),
  ...Object.entries(SCORE_GLOSS).map(([id, text]) => ({ id: `gloss.${id}`, text })),
  ...SUMMONS_LINES.map((text, i) => ({ id: `summons-${i + 1}`, text })),
  ...CALLING_LINES.map((text, i) => ({ id: `calling-${i + 1}`, text })),
  { id: "partial", text: PARTIAL_LINE },
  ...Object.entries(READING_LINES).map(([id, text]) => ({ id: `reading.${id}`, text })),
  ...Object.entries(PIPELINE_LINES).map(([id, text]) => ({ id: `pipeline.${id}`, text })),
  ...Object.entries(PAYWALL_CTA_LINES).map(([id, text]) => ({ id: `cta.${id}`, text })),
  ...Object.entries(REMINDER_CTA_LINES).map(([id, text]) => ({ id: `reminder.${id}`, text })),
  ...Object.entries(PUSH_CAMPAIGN_LINES).map(([id, text]) => ({ id: `push.${id}`, text })),
  ...LITURGY_LINES.map((text, i) => ({ id: `liturgy-${i + 1}`, text })),
  ...Object.entries(GAME_TERMS).map(([id, text]) => ({ id: `term.${id}`, text })),
  ...Object.entries(CURRENT_GAME_COPY).map(([id, text]) => ({ id: `copy.${id}`, text })),
];

describe("the vocabulary cut", () => {
  it("scans something", () => {
    expect(SURFACE.length).toBeGreaterThan(100);
  });

  it("never lets a retired word reach a player", () => {
    for (const { id, text } of SURFACE) {
      expect(text, `${id}: "${text}"`).not.toMatch(RETIRED);
    }
  });

  it("names the money words in the rules", () => {
    const rules = RITES_V2_SECTIONS.flatMap((s) => s.claims).join(" ").toLowerCase();
    for (const word of ["line", "stake", "fortune", "big one", "streak protection", "practice", "void"]) {
      expect(rules, word).toContain(word);
    }
  });

  it("keeps the archived version 2 canon whole and unscanned", () => {
    // The archive is history, so it is deliberately absent from SURFACE: it
    // carries vigils, shields and crowds because that is what a version 2
    // round was played under. All six of its rites must survive.
    expect(RITES_V2_ARCHIVE_SECTIONS.length).toBe(6);
  });

  it("keeps the rules to four sections and about twenty claims", () => {
    expect(RITES_V2_SECTIONS.length).toBe(4);
    const claims = RITES_V2_SECTIONS.reduce((n, s) => n + s.claims.length, 0);
    expect(claims).toBeGreaterThanOrEqual(18);
    expect(claims).toBeLessThanOrEqual(24);
  });
});
