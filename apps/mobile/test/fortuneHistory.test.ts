import { describe, it, expect } from "vitest";
import { fortuneHistoryLines } from "../src/game/fortuneHistory";

describe("the record's fortune history (design §8.3)", () => {
  it("lists newest first with delta and fortune after", () => {
    const lines = fortuneHistoryLines([
      { date: "2026-09-08", delta: 140, fortune_after: 1140 },
      { date: "2026-09-09", delta: -60, fortune_after: 1080 },
    ]);
    expect(lines).toEqual(["2026-09-09 · −60 · 1,080", "2026-09-08 · +140 · 1,140"]);
  });
  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, delta: 1, fortune_after: 1000 + i }));
    expect(fortuneHistoryLines(many).length).toBe(10);
    expect(fortuneHistoryLines(many, 3).length).toBe(3);
  });
  it("is empty before any settlement", () => {
    expect(fortuneHistoryLines([])).toEqual([]);
  });
});
