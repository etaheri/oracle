import { describe, expect, it } from "vitest";
import { beginHomeAction, invalidateHomeAction, ownsHomeAction, type HomeActionGate } from "../src/game/homeActionGate";

const idle = (): HomeActionGate => ({ generation: 0, pending: false, focused: true });

describe("home action generation", () => {
  it("allows only one live eligibility check at a time", () => {
    const first = beginHomeAction(idle());
    expect(first).not.toBeNull();
    expect(beginHomeAction(first!.gate)).toBeNull();
  });

  it("rejects an async completion after home loses focus", () => {
    const started = beginHomeAction(idle())!;
    const blurred = invalidateHomeAction(started.gate, false);
    expect(ownsHomeAction(blurred, started.token)).toBe(false);
    expect(blurred.pending).toBe(false);
  });

  it("rejects an older completion after a later generation starts", () => {
    const first = beginHomeAction(idle())!;
    const refocused = invalidateHomeAction(first.gate, true);
    const second = beginHomeAction(refocused)!;
    expect(ownsHomeAction(second.gate, first.token)).toBe(false);
    expect(ownsHomeAction(second.gate, second.token)).toBe(true);
  });
});

// Rites reuses this guard for BEGIN across request and persistence awaits.
describe("shared action ownership across delayed work", () => {
  it.each(["resolved", "rejected"] as const)("revokes a %s completion after alternate navigation, even after returning", async (outcome) => {
    const first = beginHomeAction(idle())!;
    let gate = first.gate;
    let resolve!: () => void;
    let reject!: () => void;
    const delayed = new Promise<void>((yes, no) => { resolve = yes; reject = () => no(new Error("request failed")); });
    // Both successful work and a caught failure must prove ownership to navigate.
    const completionOwns = delayed.then(
      () => ownsHomeAction(gate, first.token),
      () => ownsHomeAction(gate, first.token),
    );
    gate = invalidateHomeAction(gate, false); // synchronous exhibition/reference departure
    expect(beginHomeAction(gate)).toBeNull();
    gate = invalidateHomeAction(gate, true); // return to the retained screen
    const second = beginHomeAction(gate)!;
    gate = second.gate;
    if (outcome === "resolved") resolve(); else reject();
    expect(await completionOwns).toBe(false);
    // An old finally block must not clear the new attempt's pending state.
    expect(ownsHomeAction(gate, first.token)).toBe(false);
    expect(ownsHomeAction(gate, second.token)).toBe(true);
    expect(gate.pending).toBe(true);
  });
});
