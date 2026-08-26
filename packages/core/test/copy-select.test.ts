import { describe, it, expect } from "vitest";
import { COPY_BANK, selectLine } from "../src/copy";

const noon = COPY_BANK.filter((l) => l.pool === "noon");

describe("selectLine", () => {
  it("is deterministic: same seed, same line", () => {
    const a = selectLine(noon, "user-1:2026-08-26", ["results"]);
    const b = selectLine(noon, "user-1:2026-08-26", ["results"]);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });
  it("different seeds reach different lines across the pool", () => {
    const picked = new Set(
      Array.from({ length: 40 }, (_, i) => selectLine(noon, `user-${i}:2026-08-26`, ["results"])!.id),
    );
    expect(picked.size).toBeGreaterThan(3);
  });
  it("never selects a line whose requirements are unmet", () => {
    for (let i = 0; i < 40; i++) {
      const l = selectLine(noon, `u${i}`, []);
      expect(l).not.toBeNull();
      expect(l!.requires ?? []).toEqual([]);
    }
  });
  it("honors satisfied requirements (a tide winner can draw a tide line)", () => {
    const tideOnly = noon.filter((l) => l.requires?.includes("tideWin"));
    const l = selectLine(tideOnly, "any-seed", ["results", "tideWin"]);
    expect(l).not.toBeNull();
    expect(l!.requires).toContain("tideWin");
  });
  it("returns null when no line is eligible", () => {
    const tideOnly = noon.filter((l) => l.requires?.includes("tideWin"));
    expect(selectLine(tideOnly, "seed", [])).toBeNull();
  });
});
