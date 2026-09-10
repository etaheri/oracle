import { describe, it, expect } from "vitest";
import { INITIAL_CHOICE, chooseSide, chooseRung, canSeal } from "../src/game/sealFlow";

describe("the two-step seal (design D11)", () => {
  it("starts with no side and the middle rung", () => {
    expect(INITIAL_CHOICE).toEqual({ side: null, confidence: 75 });
    expect(canSeal(INITIAL_CHOICE)).toBe(false);
  });

  it("a side makes the choice sealable at the default rung, so two taps is the fastest seal", () => {
    const c = chooseSide(INITIAL_CHOICE, true);
    expect(c).toEqual({ side: true, confidence: 75 });
    expect(canSeal(c)).toBe(true);
  });

  it("switching side keeps the rung", () => {
    const c = chooseRung(chooseSide(INITIAL_CHOICE, true), 95);
    expect(chooseSide(c, false)).toEqual({ side: false, confidence: 95 });
  });

  it("a rung needs a side first, and must be on the ladder", () => {
    expect(chooseRung(INITIAL_CHOICE, 95)).toEqual(INITIAL_CHOICE);
    const sided = chooseSide(INITIAL_CHOICE, true);
    expect(chooseRung(sided, 60)).toEqual(sided);   // on the grid, not on the ladder
    expect(chooseRung(sided, 55).confidence).toBe(55);
    expect(chooseRung(sided, 95).confidence).toBe(95);
  });
});
