import { describe, it, expect } from "vitest";
import { INTRO_LINES, RITES_V2_SECTIONS, emphasizeClaims, type ClaimSegment } from "../src/copy";
import { CURRENT_GAME_COPY } from "../src/gameCopy";

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

describe("the rules for hot takes (design 2026-09-22 §9.4)", () => {
  it("opens on the room, and settles on the players' majority", () => {
    expect(INTRO_LINES).toEqual([
      "Five hot takes a day. The Oracle has already guessed what the room will say.",
      "Swipe right for YES, left for NO. Nothing about the room shows until you seal.",
      "You win when you land with the majority. After your fifth seal, place your double on the call you are surest of.",
    ]);
    const game = RITES_V2_SECTIONS.find((s) => s.title === "The game")!;
    expect(game.claims[0]).toBe("Five hot takes a day. Each is an opinion, and the answer is whatever most of the players say.");
    expect(game.claims[1]).toBe("On every question the Oracle posts its line: the share of the room it expects to say YES. You see it once you seal.");
    expect(game.claims[4]).toBe("A call with the majority wins the stake at the Oracle's odds; a call against it loses the stake.");
    const results = RITES_V2_SECTIONS.find((s) => s.title === "Results and the board")!;
    expect(results.claims[0]).toBe("Questions settle on the players' majority at lock.");
    const timing = RITES_V2_SECTIONS.find((s) => s.title === "Timing and fairness")!;
    expect(timing.claims[1]).toBe("Results land at the next noon, when the round locks.");
    expect(CURRENT_GAME_COPY.opponentChallenge).toBe("Can you read the room better?");
  });
});
