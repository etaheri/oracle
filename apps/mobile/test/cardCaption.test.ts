import { describe, it, expect } from "vitest";
import { cardCoordinate, cardModifiers } from "../src/game/cardCaption";

const base = { slot: 3, source_name: "Kalshi", crowd: false, seen_on: null };

describe("the card's caption (design 2026-09-25 §4.3)", () => {
  it("says where a hot take was seen", () => {
    expect(cardCoordinate({ ...base, crowd: true, source_name: "THE PLAYERS", seen_on: { label: "r/AmItheAsshole", url: "https://r/x" } })).toBe(":: III / SEEN ON R/AMITHEASSHOLE");
  });
  it("says the night shift wrote it when it came from the day's mood", () => {
    expect(cardCoordinate({ ...base, crowd: true, source_name: "THE PLAYERS" })).toBe(":: III / THE NIGHT SHIFT");
  });
  it("keeps the source on a market question", () => {
    expect(cardCoordinate(base)).toBe(":: III / PER KALSHI");
  });
  it("stacks the modifiers in one order", () => {
    expect(cardModifiers({ is_big_one: false, unhinged: false }, false)).toBe("");
    expect(cardModifiers({ is_big_one: false, unhinged: true }, false)).toBe("UNHINGED");
    expect(cardModifiers({ is_big_one: true, unhinged: true }, true)).toBe("STAKES DOUBLE · UNHINGED · CLOSES EARLY");
  });
});
