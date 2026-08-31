import { describe, it, expect } from "vitest";
import { leanProgress, leanRelease, leanStep, holdConfidence, LEAN_COMMIT, LEAN_DEAD_ZONE, LEAN_FULL, HOLD_STEP_MS } from "../src/game/swipeLean";

const W = 320; // card width in px

describe("the scale itself", () => {
  it("commits within one small nudge — conviction must feel instant", () => {
    expect(LEAN_COMMIT).toBeLessThanOrEqual(0.15);
    expect(LEAN_COMMIT).toBeGreaterThan(LEAN_DEAD_ZONE);
  });
  it("tops out well within a single thumb stroke", () => {
    expect(LEAN_FULL).toBeLessThanOrEqual(0.7);
    expect(LEAN_FULL).toBeGreaterThan(LEAN_COMMIT);
  });
});

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
  it("a pull to LEAN_FULL lands maximum conviction, and further pulls clamp there", () => {
    expect(leanRelease(W * LEAN_FULL, W)).toEqual({ answer: true, confidence: 95 });
    expect(leanRelease(W, W)).toEqual({ answer: true, confidence: 95 });
    expect(leanRelease(-W * 3, W)).toEqual({ answer: false, confidence: 95 });
  });
  it("mid-pull maps onto the 55-95 grid symmetrically", () => {
    const mid = W * (LEAN_COMMIT + (LEAN_FULL - LEAN_COMMIT) / 2);
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

describe("leanStep", () => {
  it("is -1 below the commit threshold and 0..8 above it", () => {
    expect(leanStep(0, W)).toBe(-1);
    expect(leanStep(W * (LEAN_COMMIT - 0.01), W)).toBe(-1);
    expect(leanStep(W * LEAN_COMMIT, W)).toBe(0);
    expect(leanStep(W * LEAN_FULL, W)).toBe(8);
    expect(leanStep(W, W)).toBe(8); // clamps past LEAN_FULL
    expect(leanStep(-W, W)).toBe(8); // magnitude only — side is the sign of dx
    expect(leanStep(100, 0)).toBe(-1);
  });
  it("agrees with leanRelease across the whole pull", () => {
    for (let dx = -W; dx <= W; dx += 3) {
      const step = leanStep(dx, W);
      const r = leanRelease(dx, W);
      if (step === -1) expect(r).toBeNull();
      else expect(r!.confidence).toBe(55 + step * 5);
    }
  });
});

describe("holdConfidence", () => {
  it("charges from 55 to 95 as the hold lengthens, on the grid, capped", () => {
    expect(holdConfidence(0)).toBe(55);
    expect(holdConfidence(HOLD_STEP_MS - 1)).toBe(55);
    expect(holdConfidence(HOLD_STEP_MS)).toBe(60);
    expect(holdConfidence(HOLD_STEP_MS * 8)).toBe(95);
    expect(holdConfidence(HOLD_STEP_MS * 50)).toBe(95);
    expect(holdConfidence(-100)).toBe(55);
  });
});
