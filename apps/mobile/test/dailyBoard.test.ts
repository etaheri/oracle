import { describe, it, expect } from "vitest";
import { CONSTANTS, type RoundBoard } from "@oracle/core";
import { boardLines, BOARD_MAX_LINES, FIELD_GATHERING_LINE, UNRATED_LINE, oracleDayLine, boardRowLines } from "../src/game/dailyBoard";

function board(overrides: Partial<RoundBoard> = {}): RoundBoard {
  return {
    date: "2026-08-20",
    field_size: 214,
    your_points: 137,
    your_rank: 31,
    rows: [],
    best_points: 268,
    median_points: 44,
    ...overrides,
  };
}

describe("boardLines", () => {
  it("says nothing at all until the board has arrived", () => {
    expect(boardLines(undefined)).toEqual([]);
  });

  it("reads the rank against the shape of the field", () => {
    expect(boardLines(board())).toEqual(["RANK 31 OF 214 · BEST 268 · MEDIAN 44"]);
  });

  it("holds its tongue while the field is smaller than the floor", () => {
    // Same posture as crowdVerdict's floor: a rank over three people is
    // mostly the reader. The API has already nulled the comparisons.
    expect(boardLines(board({ field_size: CONSTANTS.BOARD_MIN_FIELD - 1, your_rank: null, best_points: null, median_points: null })))
      .toEqual([FIELD_GATHERING_LINE]);
  });

  it("says why a partial day has no rank, rather than showing none", () => {
    expect(boardLines(board({ your_points: null, your_rank: null }))).toEqual([UNRATED_LINE]);
  });

  it("names the caller's own absence before the field's size", () => {
    // Both are true at once on a quiet install day. The reader's own day is
    // the more specific fact, and the one they can do something about.
    expect(boardLines(board({ field_size: 2, your_points: null, your_rank: null, best_points: null, median_points: null })))
      .toEqual([UNRATED_LINE]);
  });

  it("writes a losing field with a true minus, never a hyphen", () => {
    const lines = boardLines(board({ your_points: -100, your_rank: 5, best_points: -20, median_points: -60 }));
    expect(lines).toEqual(["RANK 5 OF 214 · BEST −20 · MEDIAN −60"]);
    expect(lines.join("")).not.toContain("-");
  });

  it("never grows past the height the reveal reserves for it", () => {
    // The reveal holds this slot open at BOARD_MAX_LINES so the block arrives
    // rather than shoving the page down when the query resolves.
    const states = [
      undefined,
      board(),
      board({ your_rank: null, best_points: null, median_points: null }),
      board({ your_points: null, your_rank: null }),
      board({ field_size: 0, your_points: null, your_rank: null, best_points: null, median_points: null }),
    ];
    for (const s of states) expect(boardLines(s).length).toBeLessThanOrEqual(BOARD_MAX_LINES);
  });

  it("keeps the register: caps, no emoji, no exclamation, no CTA verbs", () => {
    const BANNED = ["CHECK", "TAP", "CLICK", "VISIT", "RESULTS", "DON'T MISS"];
    const all = [
      ...boardLines(board()),
      ...boardLines(board({ your_rank: null, best_points: null, median_points: null })),
      ...boardLines(board({ your_points: null, your_rank: null })),
    ];
    for (const line of all) {
      expect(line).toBe(line.toUpperCase());
      expect(line).not.toContain("!");
      for (const b of BANNED) expect(line).not.toContain(b);
    }
  });
});

describe("oracleDayLine", () => {
  const q = (outcome: "yes" | "no" | "void" | null, oracle: number | null, mine: boolean | null) =>
    ({ outcome, oracle_p_yes: oracle, my: mine === null ? null : { answer: mine } });

  it("names both counts, the player first", () => {
    // oracle_p_yes 0.9 on an outcome of "no" is an Oracle miss (see
    // packages/core/test/oracleRecord.test.ts's identical fixture, which
    // labels this exact case "oracle wrong") -- the brief's expected count
    // here was THE ORACLE 2; the correct count against dayCallCounts is 1.
    expect(oracleDayLine([q("yes", 0.8, true), q("no", 0.9, false), q("yes", 0.2, true)]))
      .toBe("YOU 3 · THE ORACLE 1");
  });
  it("says nothing when the machine never forecast the day", () => {
    expect(oracleDayLine([q("yes", null, true), q("no", null, false)])).toBeNull();
  });
  it("says nothing on a day with no outcomes yet", () => {
    expect(oracleDayLine([q(null, 0.8, true)])).toBeNull();
  });
  it("still speaks for a spectator who sealed nothing", () => {
    expect(oracleDayLine([q("yes", 0.8, null), q("no", 0.9, null)])).toBe("YOU 0 · THE ORACLE 1");
  });
});

describe("boardRowLines", () => {
  const rows = [
    { name: "THE COLD WITNESS", points: 268, rank: 1, is_you: false, is_oracle: false },
    { name: "THE ORACLE", points: 184, rank: 3, is_you: false, is_oracle: true },
    { name: "THE PATIENT SCRIBE", points: 96, rank: 7, is_you: true, is_oracle: false },
  ];
  it("writes rank, name and a signed level", () => {
    expect(boardRowLines(rows)[0]).toBe("1 · THE COLD WITNESS · 268");
  });
  it("signs a losing level with a true minus, never a hyphen", () => {
    const line = boardRowLines([{ ...rows[0]!, points: -40 }])[0]!;
    expect(line).toContain("−40");
    expect(line).not.toContain("-40");
  });
  it("returns nothing for an empty field", () => {
    expect(boardRowLines([])).toEqual([]);
  });
});
