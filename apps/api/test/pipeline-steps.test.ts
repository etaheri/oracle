import { describe, expect, it } from "vitest";
import { POLICY } from "../src/pipeline/steps";

describe("step policies", () => {
  it("never inherits the 10-minute default timeout", () => {
    // Spec §4.2: an inherited timeout is the defect in §1.1. Every policy
    // must state its own, and every one must be under the default.
    for (const [name, p] of Object.entries(POLICY)) {
      expect(p.timeout, name).toBeDefined();
      expect(p.timeout, name).not.toBe("10 minutes");
    }
  });

  it("gives the fail-closed and no-retry policies zero retries", () => {
    // Spec §5.1: taste's guarantee must be DECLARED, not emergent.
    // Spec §4.1: resolve/probe steps take limit 0 because the hourly cron IS
    // their retry layer.
    expect(POLICY.failClosed.retries.limit).toBe(0);
    expect(POLICY.noRetry.retries.limit).toBe(0);
  });

  it("keeps the wide model fan-out shallow", () => {
    // Spec §3.1: preflight is 12 wide; limit 1 caps it at 24 calls.
    expect(POLICY.modelWide.retries.limit).toBe(1);
  });
});
