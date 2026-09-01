import { describe, expect, it } from "vitest";
import { haloDwell, haloGate } from "../src/game/haloMood";

describe("haloGate", () => {
  it("holds the floor for an empty day", () => {
    expect(haloGate(0)).toBeCloseTo(0.14);
    expect(haloGate(-5)).toBeCloseTo(0.14);
    expect(haloGate(Number.NaN)).toBeCloseTo(0.14);
  });

  it("rises with turnout and never passes the sparse ceiling", () => {
    expect(haloGate(8)).toBeGreaterThan(haloGate(0));
    expect(haloGate(600)).toBeGreaterThan(haloGate(8));
    expect(haloGate(50_000)).toBeLessThanOrEqual(0.34);
  });

  it("front-loads the curve, so the first hundred read as a crowd arriving", () => {
    const firstHundred = haloGate(100) - haloGate(0);
    const nextFourHundred = haloGate(500) - haloGate(100);
    expect(firstHundred).toBeGreaterThan(nextFourHundred);
  });
});

describe("haloDwell", () => {
  it("dwells calmly while the crowd is unknown", () => {
    expect(haloDwell(null)).toEqual([2, 6]);
  });

  it("re-rolls fastest on a dead-split crowd", () => {
    const [splitLo] = haloDwell(50);
    const [agreedLo] = haloDwell(97);
    expect(splitLo).toBeLessThan(agreedLo);
  });

  it("is symmetric — a unanimous YES is as calm as a unanimous NO", () => {
    expect(haloDwell(0)).toEqual(haloDwell(100));
  });

  it("always returns a positive, ordered range", () => {
    for (const lean of [null, 0, 12, 50, 73, 100]) {
      const [lo, hi] = haloDwell(lean);
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThan(lo);
    }
  });

  it("clamps a percentage that arrives out of range", () => {
    expect(haloDwell(140)).toEqual(haloDwell(100));
    expect(haloDwell(-20)).toEqual(haloDwell(0));
  });
});
