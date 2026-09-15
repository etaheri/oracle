import { describe, it, expect } from "vitest";
import { INITIAL_CHOICE, chooseSide, canSeal } from "../src/game/sealFlow";

describe("the swipe seal (design H2)", () => {
  it("starts with no side and cannot seal", () => {
    expect(INITIAL_CHOICE).toEqual({ side: null });
    expect(canSeal(INITIAL_CHOICE)).toBe(false);
  });
  it("a side is the whole choice", () => {
    expect(chooseSide(INITIAL_CHOICE, true)).toEqual({ side: true });
    expect(canSeal(chooseSide(INITIAL_CHOICE, false))).toBe(true);
  });
  it("carries no confidence", () => {
    expect(Object.keys(chooseSide(INITIAL_CHOICE, true))).toEqual(["side"]);
  });
});
