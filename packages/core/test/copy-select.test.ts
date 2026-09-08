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

import { vigilLine } from "../src/copy";

describe("vigilLine", () => {
  it("is null below a 2-day streak", () => {
    expect(vigilLine(0, "k")).toBeNull();
    expect(vigilLine(1, "k")).toBeNull();
  });
  it("fills the streak into a vigil line and never draws a lapse line", () => {
    for (let i = 0; i < 30; i++) {
      const line = vigilLine(7, `seed-${i}`);
      expect(line).not.toBeNull();
      expect(line).toContain("7");
      expect(line).not.toMatch(/UNCONSULTED|GAP|STREAKS END|SHIELD|BEGIN AGAIN/);
    }
  });
  it("is deterministic per seed", () => {
    expect(vigilLine(4, "home:2026-08-27:4")).toBe(vigilLine(4, "home:2026-08-27:4"));
  });
});

import { RITES_V2_LINES, RITES_LINES, PUSH_CAMPAIGN_LINES } from "../src/copy";
import { CURRENT_GAME_COPY, GAME_TERMS } from "../src/gameCopy";
describe("current factual copy", () => {
  it("separates cumulative skill, participation and archived multipliers", () => {
    const current = RITES_V2_LINES.join(" ");
    expect(current).toContain("50 cumulative qualifying calls, not consecutive days");
    expect(current).toContain("at least one call");
    expect(current).toContain("at least three resolved");
    expect(current).toContain("do not multiply");
    expect(RITES_LINES.join(" ")).toContain("TEN PERCENT MORE");
    expect(CURRENT_GAME_COPY.shieldUsed).toContain("No calls were added");
    expect(GAME_TERMS.playerRating).toBe("Your forecast rating");
    expect(PUSH_CAMPAIGN_LINES.plusWelcome).not.toContain("YOUR VIGIL IS PROTECTED");
  });
  it("requires evidence for results and social proof", () => {
    for (const line of COPY_BANK) {
      if (line.text.includes("RESULT IS READY")) expect(line.requires).toContain("results");
      if (line.text.includes("PLAYERS HAVE MADE")) expect(line.requires).toContain("players");
    }
    const social = COPY_BANK.filter(line => line.requires?.includes("players"));
    expect(selectLine(social, "empty-crowd", [])).toBeNull();
  });
});

it("counts human players for the daily board minimum", async () => {
  const { RITES_V2_SECTIONS } = await import("../src/copy");
  const { CONSTANTS } = await import("../src/constants");
  const record = RITES_V2_SECTIONS.find(section => section.title === "Build your record")!.text;
  expect(record).toContain(`${CONSTANTS.BOARD_MIN_FIELD} eligible players; the Oracle is also shown for comparison`);
  expect(record).not.toContain("including the Oracle");
});
