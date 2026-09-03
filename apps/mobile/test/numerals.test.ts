import { describe, it, expect } from "vitest";
import { RITES_LINES } from "@oracle/core";
import { NUMERALS, numeral } from "../src/game/numerals";

describe("numerals", () => {
  it("covers the whole canon, so no rite falls back to arabic", () => {
    // numerals.ts's own comment has claimed this was asserted somewhere for
    // as long as it has existed. It was not, which is how the canon grew to
    // fifteen while the table stopped at fourteen and the last rite rendered
    // as "15" in a list of Roman numerals.
    expect(NUMERALS.length).toBeGreaterThanOrEqual(RITES_LINES.length);
    expect(numeral(RITES_LINES.length)).not.toMatch(/\d/);
  });

  it("falls back to arabic only past the table", () => {
    expect(numeral(1)).toBe("I");
    expect(numeral(NUMERALS.length)).toBe(NUMERALS[NUMERALS.length - 1]);
    expect(numeral(NUMERALS.length + 1)).toBe(String(NUMERALS.length + 1));
  });
});
