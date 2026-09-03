import { describe, it, expect } from "vitest";
import { designation, disambiguate, ORACLE_DESIGNATION } from "../src/designation";
import { CONSTANTS } from "../src/constants";

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe("designation", () => {
  it("is stable for the same id -- a rival must survive the night", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(designation(id)).toBe(designation(id));
  });
  it("differs across ids", () => {
    const names = new Set(
      Array.from({ length: 200 }, (_, i) => designation(`user-${i}`)),
    );
    // Not uniqueness -- collisions are expected and handled by disambiguate.
    // This only asserts the hash actually spreads.
    expect(names.size).toBeGreaterThan(80);
  });
  it("holds the machine register", () => {
    for (let i = 0; i < 300; i++) {
      const name = designation(`user-${i}`);
      expect(name).toBe(name.toUpperCase());
      expect(name).not.toMatch(EMOJI);
      expect(name).not.toContain("!");
      expect(name.startsWith("THE ")).toBe(true);
      expect(name.length).toBeLessThanOrEqual(28);
    }
  });
  it("never collides with the machine's own name", () => {
    for (let i = 0; i < 300; i++) {
      expect(designation(`user-${i}`)).not.toBe(ORACLE_DESIGNATION);
    }
  });
});

describe("disambiguate", () => {
  it("leaves distinct names alone", () => {
    expect(disambiguate(["THE COLD WITNESS", "THE PATIENT SCRIBE"]))
      .toEqual(["THE COLD WITNESS", "THE PATIENT SCRIBE"]);
  });
  it("numbers repeats in the order they appear", () => {
    expect(disambiguate(["THE COLD WITNESS", "THE COLD WITNESS", "THE COLD WITNESS"]))
      .toEqual(["THE COLD WITNESS", "THE COLD WITNESS II", "THE COLD WITNESS III"]);
  });
});

describe("board window", () => {
  it("reserves room for every row the board's window can produce", () => {
    const { BOARD_TOP_ROWS, BOARD_NEIGHBOURS, BOARD_ROWS_MAX } = CONSTANTS;
    // The route keeps: the top rows, the caller's own window (the caller plus
    // BOARD_NEIGHBOURS either side), and the Oracle pinned in from outside
    // both. Disjoint in the worst case, which is the case the reveal must
    // reserve height for.
    const worstCase = BOARD_TOP_ROWS + (1 + 2 * BOARD_NEIGHBOURS) + 1;
    expect(BOARD_ROWS_MAX).toBeGreaterThanOrEqual(worstCase);
  });
});
