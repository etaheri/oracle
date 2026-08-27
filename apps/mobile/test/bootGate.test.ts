import { beforeEach, describe, expect, it, vi } from "vitest";
import { markBootDone, onBootDone, resetBootGateForTest } from "../src/game/bootGate";

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
