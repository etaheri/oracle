import { describe, it, expect } from "vitest";
import { RITES_V2_SECTIONS, emphasizeClaims, type ClaimSegment } from "../src/copy";

const flat = (segs: ClaimSegment[][]) => segs.map(s => s.map(x => x.text).join(""));
const terms = (segs: ClaimSegment[][]) => segs.flat().filter(s => s.term).map(s => s.text);

describe("defined terms", () => {
  it("never alters the claim's text", () => {
    for (const section of RITES_V2_SECTIONS) {
      expect(flat(emphasizeClaims(section.claims, section.defines))).toEqual([...section.claims]);
    }
  });

  it("marks each term exactly once, in the rite that defines it", () => {
    for (const section of RITES_V2_SECTIONS) {
      const marked = terms(emphasizeClaims(section.claims, section.defines)).map(t => t.toLowerCase());
      expect(marked.sort(), section.title).toEqual([...section.defines].sort());
    }
  });

  it("respects word boundaries: a term never matches inside a longer word", () => {
    // "call" must not fire on "calls"; "seal" must not fire on "Sealing".
    const segs = emphasizeClaims(["Your calls and sealing are counted.", "Release to seal."], ["seal"]);
    expect(terms(segs)).toEqual(["seal"]);
    expect(segs[0]!.every(s => !s.term)).toBe(true);
  });

  it("marks the earliest term when two are pending in one claim", () => {
    const segs = emphasizeClaims(["A shield protects a vigil."], ["vigil", "shield"]);
    expect(terms(segs)).toEqual(["shield", "vigil"]);
  });

  it("leaves a claim untouched when the section defines nothing", () => {
    expect(emphasizeClaims(["Plain sentence."], [])).toEqual([[{ text: "Plain sentence.", term: false }]]);
  });
});
