import { describe, it, expect } from "vitest";
import { snapConfidence, confidenceReading } from "../src/game/confidence";

describe("snapConfidence", () => {
  it("maps ratio extremes to grid extremes and clamps", () => {
    expect(snapConfidence(0)).toBe(55);
    expect(snapConfidence(1)).toBe(95);
    expect(snapConfidence(-0.5)).toBe(55);
    expect(snapConfidence(1.5)).toBe(95);
  });
  it("snaps to nearest step-5 detent", () => {
    expect(snapConfidence(0.5)).toBe(75);
    expect(snapConfidence(0.49)).toBe(75);
    expect(snapConfidence(0.55)).toBe(75);
    expect(snapConfidence(0.62)).toBe(80);
  });
  it("only ever produces grid values", () => {
    for (let r = 0; r <= 1.0001; r += 0.01) {
      const c = snapConfidence(r);
      expect(c).toBeGreaterThanOrEqual(55);
      expect(c).toBeLessThanOrEqual(95);
      expect((c - 55) % 5).toBe(0);
    }
  });
});

describe("confidenceReading", () => {
  it("has a distinct line for every detent", () => {
    const seen = new Set<string>();
    for (let c = 55; c <= 95; c += 5) seen.add(confidenceReading(c));
    expect(seen.size).toBe(9);
    expect(confidenceReading(75)).toBe("THE SIGNS ARE CLEAR");
  });
});
