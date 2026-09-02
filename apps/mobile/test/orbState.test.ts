import { describe, expect, it } from "vitest";
import {
  isTransient,
  nextState,
  settleTo,
  targetsFor,
  isFrozen,
  leanVector,
  transitionMs,
  type OrbState,
} from "../src/ui/orb/orbState";

const ALL: OrbState[] = ["dormant", "waking", "attending", "sealed", "revealing", "spent"];

describe("targetsFor", () => {
  it("freezes the orb completely while dormant", () => {
    const t = targetsFor("dormant");
    // The boot rite holds a still. Every warp must be at baseline, or the
    // still would not be the reference image.
    expect(t.timeScale).toBe(0);
    expect(t.parallax).toBe(0);
    expect(t.centerDepth).toBe(0);
    expect(t.centerLean).toBe(0);
    expect(t.refraction).toBe(0);
  });

  it("opens the interior's depth when the day is being revealed", () => {
    // Revealing advances the centre toward the front glass: negative depth.
    expect(targetsFor("revealing").centerDepth).toBeLessThan(0);
    expect(targetsFor("revealing").halo).toBeGreaterThan(targetsFor("attending").halo);
  });

  it("lets the centre recede when the day is spent, without erasing it", () => {
    expect(targetsFor("spent").centerDepth).toBeGreaterThan(0);
    expect(targetsFor("spent").halo).toBeLessThan(targetsFor("attending").halo);
  });

  it("settles the interior once the player has sealed", () => {
    expect(targetsFor("sealed").parallax).toBeLessThan(targetsFor("attending").parallax);
  });

  it("keeps every state inside the range the shader can carry", () => {
    for (const s of ALL) {
      const t = targetsFor(s);
      expect(t.parallax).toBeGreaterThanOrEqual(0);
      expect(t.parallax).toBeLessThanOrEqual(1);
      expect(t.halo).toBeGreaterThanOrEqual(0);
      expect(t.halo).toBeLessThanOrEqual(1);
      expect(Math.abs(t.centerDepth)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(t.centerLean)).toBeLessThanOrEqual(0.5);
      expect(t.refraction).toBeGreaterThanOrEqual(0);
      expect(t.refraction).toBeLessThanOrEqual(1);
      expect(t.timeScale).toBeGreaterThanOrEqual(0);
    }
  });

  it("never returns an opaque or degenerate interior", () => {
    // A centre that scaled toward the origin would collapse into the dot the
    // brief forbids. Nothing may scale below the baseline.
    for (const s of ALL) expect(targetsFor(s).centerDepth).toBeGreaterThan(-0.5);
  });
});

describe("transitionMs", () => {
  it("runs the awakening between 700 and 1000ms", () => {
    const ms = transitionMs("dormant", "waking");
    expect(ms).toBeGreaterThanOrEqual(700);
    expect(ms).toBeLessThanOrEqual(1000);
  });

  it("moves between steady states slowly enough not to be countable", () => {
    expect(transitionMs("attending", "sealed")).toBeGreaterThanOrEqual(400);
  });

  it("is symmetric for steady states", () => {
    expect(transitionMs("attending", "spent")).toBe(transitionMs("spent", "attending"));
  });
});

describe("transients", () => {
  it("marks only waking and revealing as transient", () => {
    expect(isTransient("waking")).toBe(true);
    expect(isTransient("revealing")).toBe(true);
    expect(isTransient("attending")).toBe(false);
    expect(isTransient("dormant")).toBe(false);
  });

  it("settles a transient into the state that should follow it", () => {
    expect(settleTo("waking")).toBe("attending");
    expect(settleTo("revealing")).toBe("spent");
  });

  it("leaves steady states where they are", () => {
    expect(settleTo("attending")).toBe("attending");
    expect(settleTo("sealed")).toBe("sealed");
  });
});

describe("nextState", () => {
  it("accepts any move out of a steady state", () => {
    expect(nextState("attending", "sealed")).toBe("sealed");
    expect(nextState("sealed", "revealing")).toBe("revealing");
  });

  it("refuses to restart a transient that is already running", () => {
    // Without this, a parent re-rendering with the same prop would re-run the
    // awakening on every commit.
    expect(nextState("waking", "waking")).toBe("waking");
    expect(nextState("revealing", "revealing")).toBe("revealing");
  });

  it("never returns to dormant once the orb has woken", () => {
    // Dormant is the boot rite's still. Going back would freeze a live orb.
    expect(nextState("attending", "dormant")).toBe("attending");
    expect(nextState("waking", "dormant")).toBe("waking");
  });

  it("lets a real state change interrupt a transient", () => {
    expect(nextState("waking", "sealed")).toBe("sealed");
  });
});

describe("leanVector", () => {
  it("reproduces the shipped lean exactly when nothing is touching the orb", () => {
    // Baseline identity: with no gesture and no stir, the composed lean must
    // be the scalar mapping the shader shipped with, or every state's look
    // changes the day a gesture layer is added.
    const s = targetsFor("attending").centerLean;
    expect(leanVector(s, 0, 0)).toEqual([s, s * 0.4]);
  });

  it("is nothing at all when the state asks for nothing", () => {
    expect(leanVector(0, 0, 0)).toEqual([0, 0]);
  });

  it("adds a gesture's offset on top of the state's own lean", () => {
    const s = 0.08;
    expect(leanVector(s, 0.1, -0.05)).toEqual([s + 0.1, s * 0.4 - 0.05]);
  });
});

describe("isFrozen", () => {
  it("freezes only the boot rite's still", () => {
    // dormant IS the reference image, held motionless while the rite slides
    // it across the screen. Nothing may animate it -- not the accelerometer,
    // not a stir. Every other state is live.
    expect(isFrozen("dormant")).toBe(true);
    for (const s of ALL.filter((s) => s !== "dormant")) {
      expect(isFrozen(s)).toBe(false);
    }
  });
});
