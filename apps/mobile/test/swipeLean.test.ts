import { describe, it, expect } from "vitest";
import { leanProgress, leanRelease, LEAN_COMMIT, LEAN_DEAD_ZONE } from "../src/game/swipeLean";

const W = 320; // card width in px

describe("leanProgress", () => {
  it("is zero inside the dead zone", () => {
    expect(LEAN_DEAD_ZONE).toBeGreaterThan(0);
    expect(leanProgress(W * LEAN_DEAD_ZONE * 0.9, W)).toBe(0);
    expect(leanProgress(-W * LEAN_DEAD_ZONE * 0.9, W)).toBe(0);
  });
  it("tracks the drag as a fraction of card width, clamped to ±1", () => {
    expect(leanProgress(W * 0.5, W)).toBeCloseTo(0.5);
    expect(leanProgress(-W * 0.5, W)).toBeCloseTo(-0.5);
    expect(leanProgress(W * 2, W)).toBe(1);
    expect(leanProgress(-W * 2, W)).toBe(-1);
  });
  it("is zero when the card has no measured width", () => {
    expect(leanProgress(100, 0)).toBe(0);
  });
});

describe("leanRelease", () => {
  it("returns null under the commit threshold — the card springs back", () => {
    expect(leanRelease(W * (LEAN_COMMIT - 0.01), W)).toBeNull();
    expect(leanRelease(-W * (LEAN_COMMIT - 0.01), W)).toBeNull();
    expect(leanRelease(0, W)).toBeNull();
    expect(leanRelease(100, 0)).toBeNull();
  });
  it("a nudge just past the threshold selects the side at minimum conviction", () => {
    expect(leanRelease(W * LEAN_COMMIT, W)).toEqual({ answer: true, confidence: 55 });
    expect(leanRelease(-W * LEAN_COMMIT, W)).toEqual({ answer: false, confidence: 55 });
  });
  it("a full pull lands maximum conviction", () => {
    expect(leanRelease(W, W)).toEqual({ answer: true, confidence: 95 });
    expect(leanRelease(-W * 3, W)).toEqual({ answer: false, confidence: 95 });
  });
  it("mid-pull maps onto the 55-95 grid symmetrically", () => {
    const mid = W * (LEAN_COMMIT + (1 - LEAN_COMMIT) / 2);
    expect(leanRelease(mid, W)).toEqual({ answer: true, confidence: 75 });
    expect(leanRelease(-mid, W)).toEqual({ answer: false, confidence: 75 });
  });
  it("always lands on the step-5 grid", () => {
    for (let dx = 0; dx <= W; dx += 7) {
      const r = leanRelease(dx, W);
      if (r) expect((r.confidence - 55) % 5).toBe(0);
    }
  });
});
