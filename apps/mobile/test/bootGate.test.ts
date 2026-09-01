import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markBootDone, onBootDone, isBootDone,
  markOrbLanded, onOrbLanded, isOrbLanded,
  setHeroAnchor, getHeroAnchor, resetBootGateForTest,
} from "../src/game/bootGate";

describe("bootGate", () => {
  beforeEach(() => resetBootGateForTest());

  it("defers callbacks until the rite ends", () => {
    const cb = vi.fn();
    onBootDone(cb);
    expect(cb).not.toHaveBeenCalled();
    markBootDone();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires immediately once already done", () => {
    markBootDone();
    const cb = vi.fn();
    onBootDone(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("is idempotent and fires each listener once", () => {
    const cb = vi.fn();
    onBootDone(cb);
    markBootDone();
    markBootDone();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("honors unsubscribe", () => {
    const cb = vi.fn();
    const off = onBootDone(cb);
    off();
    markBootDone();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("bootGate: orbLanded phase", () => {
  beforeEach(() => resetBootGateForTest());

  it("is independent of bootDone", () => {
    markBootDone();
    expect(isBootDone()).toBe(true);
    expect(isOrbLanded()).toBe(false);
  });

  it("defers callbacks until the orb lands", () => {
    const cb = vi.fn();
    onOrbLanded(cb);
    expect(cb).not.toHaveBeenCalled();
    markOrbLanded();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(isOrbLanded()).toBe(true);
  });

  it("fires immediately once already landed, is idempotent, honors unsubscribe", () => {
    markOrbLanded();
    const late = vi.fn();
    onOrbLanded(late);
    expect(late).toHaveBeenCalledTimes(1);
    markOrbLanded();
    expect(late).toHaveBeenCalledTimes(1);

    resetBootGateForTest();
    const cb = vi.fn();
    const off = onOrbLanded(cb);
    off();
    markOrbLanded();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("bootGate: hero anchor", () => {
  beforeEach(() => resetBootGateForTest());

  it("is null until published", () => {
    expect(getHeroAnchor()).toBeNull();
  });

  it("returns the latest published rect", () => {
    setHeroAnchor({ x: 10, y: 20, w: 100, h: 100 });
    setHeroAnchor({ x: 12, y: 300, w: 100, h: 100 });
    expect(getHeroAnchor()).toEqual({ x: 12, y: 300, w: 100, h: 100 });
  });

  it("is cleared by reset", () => {
    setHeroAnchor({ x: 1, y: 2, w: 3, h: 3 });
    resetBootGateForTest();
    expect(getHeroAnchor()).toBeNull();
  });
});
