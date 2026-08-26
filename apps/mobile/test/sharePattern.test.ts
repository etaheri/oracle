import { describe, it, expect } from "vitest";
import { patternLine, shareMessage } from "../src/game/sharePattern";

describe("patternLine", () => {
  it("pairs Roman numerals with result marks", () => {
    expect(patternLine(["win", "loss", "none", "void", "win"])).toBe("I✓ II✗ III· IV∅ V✓");
  });
});

describe("shareMessage", () => {
  it("composes date, pattern, signed points, and the taunt", () => {
    expect(shareMessage({ date: "2026-08-26", dayPoints: 58, results: ["win", "loss", "win", "win", "win"] }))
      .toBe("🔮 ORACLE 2026-08-26 — I✓ II✗ III✓ IV✓ V✓ · +58 · can you outsee me?");
  });
  it("keeps the minus sign on negative days", () => {
    expect(shareMessage({ date: "2026-08-26", dayPoints: -12, results: ["loss", "none", "none", "none", "none"] }))
      .toContain("· -12 ·");
  });
});
