import { describe, expect, it } from "vitest";
import { POLICY } from "../src/pipeline/steps";

// Parses the "N minute(s)" / "N second(s)" forms POLICY actually uses.
// Throws on anything else so an unparsed unit fails loudly instead of
// silently passing the under-600s assertion below.
function seconds(duration: string): number {
  const match = /^(\d+) (second|minute)s?$/.exec(duration);
  if (!match) throw new Error(`unrecognised duration format: ${duration}`);
  const [, amount, unit] = match;
  return Number(amount) * (unit === "minute" ? 60 : 1);
}

describe("step policies", () => {
  it("never inherits or exceeds the 10-minute default timeout", () => {
    // Spec §4.2: an inherited timeout is the defect in §1.1. Every policy
    // must state its own, and every one must be strictly under the default
    // — not just different from its literal string ("15 minutes" would
    // still fail the actual defect this file exists to prevent).
    for (const [name, p] of Object.entries(POLICY)) {
      expect(p.timeout, name).toBeDefined();
      expect(seconds(p.timeout), name).toBeLessThan(600);
      // No ceiling on retry delay — parsing it successfully is the whole
      // requirement. seconds() throws on an unrecognised unit, and that
      // throw IS the assertion: durableStep casts the merged config to
      // WorkflowStepConfig before it reaches step.do, which switches off
      // type checking on both duration fields, so a malformed delay like
      // "10 secs" must fail loudly here, not silently at 3am.
      seconds(p.retries.delay);
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
