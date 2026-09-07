import { describe, expect, it } from "vitest";
import { evidenceSummary } from "../src/resolution";
describe("paired resolution evidence", () => {
  it("selects a quote together with its own safe URL", () => {
    expect(evidenceSummary({ quotes: [{ quote: "unpaired" }, { quote: "Final 3–1", url: "https://example.com/result" }] })).toEqual({ quote: "Final 3–1", quoteUrl: "https://example.com/result", reason: null });
  });
  it("withholds unsafe and empty excerpts but preserves void reasons", () => {
    for (const url of ["javascript:alert(1)", "file:///tmp/a", "bad", ""]) {
      expect(evidenceSummary({ quotes: [{ quote: "result", url }], reason: "postponed" })).toEqual({ quote: null, quoteUrl: null, reason: "postponed" });
    }
    expect(evidenceSummary({ quotes: [{ quote: "  ", url: "https://example.com" }] }).quote).toBeNull();
    expect(evidenceSummary(null)).toEqual({ quote: null, quoteUrl: null, reason: null });
  });
});
