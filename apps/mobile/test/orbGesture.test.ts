import { describe, expect, it } from "vitest";
import {
  HOLD_DEPTH,
  HOLD_HALO,
  LEAN_REACH,
  offsetsFor,
  releaseHaptic,
  releaseStrength,
} from "../src/ui/orb/orbGesture";

const CENTRE = { x: 0, y: 0 };

describe("offsetsFor", () => {
  it("changes nothing before the bloom has begun", () => {
    // Baseline identity, the shader's central bet: a finger that has just
    // landed must leave every warp term exactly where the state put it.
    const o = offsetsFor({ x: 0.5, y: -0.3 }, 0);
    // Numeric zero, not Object.is zero: a signed zero is the same uniform.
    expect(Object.entries(o).filter(([, v]) => v !== 0)).toEqual([]);
  });

  it("leans the warm centre toward the finger, not away from it", () => {
    const o = offsetsFor({ x: 0.5, y: 0 }, 1);
    expect(o.leanX).toBeCloseTo(LEAN_REACH * 0.5, 10);
    expect(o.leanY).toBe(0);
  });

  it("reaches exactly the rim's worth of lean at the rim", () => {
    expect(offsetsFor({ x: 1, y: 0 }, 1).leanX).toBeCloseTo(LEAN_REACH, 10);
  });

  it("clamps a point outside the silhouette to the rim", () => {
    // locate() rejects these, but the shader must never be handed a lean it
    // cannot express -- a warp past the rim samples outside the interior.
    const o = offsetsFor({ x: 3, y: 4 }, 1);
    expect(Math.hypot(o.leanX, o.leanY)).toBeCloseTo(LEAN_REACH, 10);
  });

  it("advances the centre toward the front glass as the hold blooms", () => {
    expect(offsetsFor(CENTRE, 1).depth).toBe(HOLD_DEPTH);
    expect(HOLD_DEPTH).toBeLessThan(0);
  });

  it("brightens the halo while held", () => {
    expect(offsetsFor(CENTRE, 1).halo).toBe(HOLD_HALO);
    expect(HOLD_HALO).toBeGreaterThan(0);
  });

  it("brings the contact dimple in well ahead of the bloom", () => {
    // The fingertip must register at once; the bloom is the slow part.
    expect(offsetsFor(CENTRE, 0.34).contact).toBe(1);
    expect(offsetsFor(CENTRE, 0.1).contact).toBeGreaterThan(0.1);
  });

  it("clamps a bloom outside [0,1]", () => {
    expect(offsetsFor({ x: 0.5, y: 0 }, 4)).toEqual(offsetsFor({ x: 0.5, y: 0 }, 1));
    expect(offsetsFor({ x: 0.5, y: 0 }, -2)).toEqual(offsetsFor({ x: 0.5, y: 0 }, 0));
  });
});

describe("releaseStrength", () => {
  it("gives a bare tap a ripple you can clearly see", () => {
    expect(releaseStrength(0)).toBeGreaterThanOrEqual(0.5);
  });

  it("grows with how long the orb was held", () => {
    expect(releaseStrength(1)).toBeGreaterThan(releaseStrength(0.5));
    expect(releaseStrength(0.5)).toBeGreaterThan(releaseStrength(0));
  });

  it("never exceeds the shader's full strength", () => {
    expect(releaseStrength(1)).toBe(1);
    expect(releaseStrength(9)).toBe(1);
  });
});

describe("releaseHaptic", () => {
  it("answers a tap lightly", () => {
    expect(releaseHaptic(0)).toBe("light");
  });

  it("answers a bloomed hold with weight", () => {
    expect(releaseHaptic(1)).toBe("medium");
  });
});
