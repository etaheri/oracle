import { describe, it, expect } from "vitest";
import { CURRENT_RULES_VERSION, ratingEligible } from "../src/roundRules";

describe("rules version 3", () => {
  it("is current", () => {
    expect(CURRENT_RULES_VERSION).toBe(3);
  });
  it("rates like version 2: every non-void answered, at least three scored", () => {
    const qs = [
      { id: "a", outcome: "yes" as const }, { id: "b", outcome: "no" as const }, { id: "c", outcome: "void" as const },
      { id: "d", outcome: "yes" as const }, { id: "e", outcome: "no" as const },
    ];
    expect(ratingEligible(3, qs, new Set(["a", "b", "d", "e"]))).toBe(true);
    expect(ratingEligible(3, qs, new Set(["a", "b", "d"]))).toBe(false);
    expect(ratingEligible(3, qs.map(q => ({ ...q, outcome: "void" as const })), new Set())).toBe(false);
  });
});
