import { describe, expect, it } from "vitest";
import { GREET_STRENGTH, STIR_LEAN, STIR_MAX_MS, STIR_MIN_MS, nextStirDelay, stirVector, stirs } from "../src/ui/orb/orbIdle";
import { targetsFor } from "../src/ui/orb/orbState";

describe("stirs", () => {
  it("holds the boot rite's still perfectly still", () => {
    // dormant IS the reference image. A stir there would animate the frame
    // the rite is sliding across the screen.
    expect(stirs("dormant")).toBe(false);
  });

  it("keeps out of a transient's way", () => {
    // waking and revealing already own the interior for their duration.
    expect(stirs("waking")).toBe(false);
    expect(stirs("revealing")).toBe(false);
  });

  it("invites a touch in every state the orb can sit in", () => {
    expect(stirs("attending")).toBe(true);
    expect(stirs("sealed")).toBe(true);
    expect(stirs("spent")).toBe(true);
  });
});

describe("nextStirDelay", () => {
  it("spans the whole window", () => {
    expect(nextStirDelay(0)).toBe(STIR_MIN_MS);
    expect(nextStirDelay(1)).toBe(STIR_MAX_MS);
  });

  it("clamps a source outside [0,1]", () => {
    expect(nextStirDelay(-3)).toBe(STIR_MIN_MS);
    expect(nextStirDelay(7)).toBe(STIR_MAX_MS);
  });

  it("leaves a window too wide to count", () => {
    // The brief's "almost imperceptible breathing": a stir a user can time is
    // a pulse, and the orb must never pulse.
    expect(STIR_MAX_MS - STIR_MIN_MS).toBeGreaterThanOrEqual(4000);
  });
});

describe("stirVector", () => {
  it("always displaces the centre by exactly the stir's reach", () => {
    for (const r of [0, 0.13, 0.5, 0.77, 0.99]) {
      const [x, y] = stirVector(r);
      expect(Math.hypot(x, y)).toBeCloseTo(STIR_LEAN, 10);
    }
  });

  it("sends successive stirs in different directions", () => {
    expect(stirVector(0.1)).not.toEqual(stirVector(0.6));
  });
});

describe("the stir's amplitude", () => {
  it("stays smaller than the state it decorates", () => {
    // A stir is a breath on top of attending's lean, not a change of state.
    expect(STIR_LEAN).toBeLessThan(targetsFor("attending").centerLean);
  });

  it("greets with a ripple short of a real touch", () => {
    // The orb moving on its own must never be mistaken for the phone
    // registering a tap the player did not make.
    expect(GREET_STRENGTH).toBeLessThan(1);
    expect(GREET_STRENGTH).toBeGreaterThan(0);
  });
});
