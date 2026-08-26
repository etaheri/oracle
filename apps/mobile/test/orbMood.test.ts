import { describe, it, expect } from "vitest";
import { crowdLean, orbGlowRgb } from "../src/game/orbMood";

describe("crowdLean", () => {
  it("is null with no sealed crowd data (anti-herding: orb starts neutral)", () => {
    expect(crowdLean([])).toBeNull();
  });
  it("averages the yes-lean across sealed questions", () => {
    expect(crowdLean([{ crowd_yes_pct: 60 }, { crowd_yes_pct: 80 }])).toBe(70);
  });
});

describe("orbGlowRgb", () => {
  it("is neutral lavender when the crowd is unknown", () => {
    expect(orbGlowRgb(null)).toEqual([183, 169, 228]);
  });
  it("is neutral lavender at a perfectly split crowd", () => {
    expect(orbGlowRgb(50)).toEqual([183, 169, 228]);
  });
  it("warms to the orb center at full YES", () => {
    expect(orbGlowRgb(100)).toEqual([242, 190, 145]);
  });
  it("cools to glass blue at full NO", () => {
    expect(orbGlowRgb(0)).toEqual([156, 181, 209]);
  });
  it("clamps out-of-range leans", () => {
    expect(orbGlowRgb(140)).toEqual([242, 190, 145]);
    expect(orbGlowRgb(-10)).toEqual([156, 181, 209]);
  });
});
