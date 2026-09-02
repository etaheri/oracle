import { describe, expect, it } from "vitest";
import {
  TILT_DEADBAND,
  TILT_REACH,
  TILT_REF_BETA,
  smooth,
  tiltOffset,
  trackReference,
} from "../src/ui/orb/orbTilt";

describe("tiltOffset", () => {
  it("does nothing at all while the phone is held still", () => {
    // Baseline identity again: a hand that is not moving must leave the
    // canonical orb exactly as the reference image has it.
    expect(tiltOffset(0, 0)).toEqual([0, 0]);
  });

  it("ignores the tremor of a hand trying to hold still", () => {
    // Below the deadband is noise, and an orb that answers noise jitters.
    const [x, y] = tiltOffset(TILT_DEADBAND * 0.9, -TILT_DEADBAND * 0.9);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it("slides the interior toward the edge that dropped", () => {
    // Gravity's x grows as the right edge goes down, and the interior is
    // heavy: it goes with gravity, not against it.
    expect(tiltOffset(0.2, 0)[0]).toBeGreaterThan(0);
    expect(tiltOffset(-0.2, 0)[0]).toBeLessThan(0);
  });

  it("sends the interior up the screen as the phone reclines", () => {
    // Reclining the top away drops gravity's z, and local +y is DOWN the
    // screen (orbTouch normalizes raw pixels), so the interior must rise.
    expect(tiltOffset(0, -0.2)[1]).toBeLessThan(0);
  });

  it("never travels further than the reach, however hard the phone is thrown", () => {
    const [x, y] = tiltOffset(9, -9);
    expect(Math.hypot(x, y)).toBeCloseTo(TILT_REACH, 10);
  });

  it("is continuous across the deadband, not a step", () => {
    // A jump at the threshold would read as the orb snapping into place.
    const [justInside] = tiltOffset(TILT_DEADBAND * 1.001, 0);
    expect(justInside).toBeGreaterThan(0);
    expect(justInside).toBeLessThan(TILT_REACH * 0.05);
  });
});

describe("trackReference", () => {
  it("leaves the reference alone when nothing moves", () => {
    expect(trackReference(-0.7, -0.7, TILT_REF_BETA)).toBeCloseTo(-0.7, 10);
  });

  it("creeps toward however the phone is actually being held", () => {
    // No calibration step: the resting angle is whatever the player's hand
    // settles at, and the orb's neutral follows it there.
    const moved = trackReference(0, 1, TILT_REF_BETA);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(0.1); // slowly -- seconds, not frames
  });

  it("eventually forgets a tilt that is simply held", () => {
    let ref = 0;
    for (let i = 0; i < 600; i++) ref = trackReference(ref, 1, TILT_REF_BETA);
    expect(ref).toBeGreaterThan(0.95);
  });
});

describe("smooth", () => {
  it("holds still when the target has not moved", () => {
    expect(smooth(0.4, 0.4, 0.2)).toBeCloseTo(0.4, 10);
  });

  it("closes only part of the gap each frame", () => {
    const next = smooth(0, 1, 0.2);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });
});
