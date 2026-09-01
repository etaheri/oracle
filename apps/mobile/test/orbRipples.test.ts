import { describe, expect, it } from "vitest";
import { assign, EMPTY_SLOTS, RIPPLE_MS, type RippleSlots } from "../src/ui/orb/orbRipples";

const at = (t: number, s = 1) => ({ origin: { x: 0, y: 0 }, startMs: t, strength: s });

describe("assign", () => {
  it("takes the first free slot", () => {
    const slots = assign(EMPTY_SLOTS, at(0), 0);
    expect(slots[0]).not.toBeNull();
    expect(slots[1]).toBeNull();
  });

  it("a second tap takes the second slot", () => {
    let slots = assign(EMPTY_SLOTS, at(0), 0);
    slots = assign(slots, at(100), 100);
    expect(slots[0]!.startMs).toBe(0);
    expect(slots[1]!.startMs).toBe(100);
  });

  it("a third tap reclaims a slot whose ripple has finished", () => {
    let slots = assign(EMPTY_SLOTS, at(0), 0);
    slots = assign(slots, at(1000), 1000);
    // At t = 1400 the first ripple is done (started at 0, lasts RIPPLE_MS).
    slots = assign(slots, at(1400), 1400);
    expect(slots[0]!.startMs).toBe(1400);
    expect(slots[1]!.startMs).toBe(1000);
  });

  it("with both still running, replaces the weakest", () => {
    let slots: RippleSlots = [at(0, 0.9), at(50, 0.3)];
    slots = assign(slots, at(100, 1), 100);
    expect(slots[0]!.strength).toBe(0.9);
    expect(slots[1]!.strength).toBe(1);
  });

  it("breaks a strength tie by replacing the oldest", () => {
    let slots: RippleSlots = [at(0, 0.5), at(50, 0.5)];
    slots = assign(slots, at(100), 100);
    expect(slots[0]!.startMs).toBe(100);
    expect(slots[1]!.startMs).toBe(50);
  });

  it("honours a capacity of one in the reduced tier", () => {
    let slots = assign(EMPTY_SLOTS, at(0), 0, 1);
    slots = assign(slots, at(100), 100, 1);
    expect(slots[0]!.startMs).toBe(100);
    expect(slots[1]).toBeNull();
  });

  it("never mutates the slots it was given", () => {
    const before = EMPTY_SLOTS;
    assign(before, at(0), 0);
    expect(before[0]).toBeNull();
  });

  it("expires a ripple exactly at RIPPLE_MS", () => {
    let slots: RippleSlots = [at(0, 1), at(0, 1)];
    slots = assign(slots, at(RIPPLE_MS), RIPPLE_MS);
    expect(slots[0]!.startMs).toBe(RIPPLE_MS);
  });
});
