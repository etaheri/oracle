import { describe, it, expect } from "vitest";
import { shareBigOneLine, fortuneShareMessage, splitShareLine } from "../src/game/shareLines";

describe("the share card's lines (design §8.3)", () => {
  it("says the Oracle's line on the Big One and what the player did about it", () => {
    expect(shareBigOneLine({ line: 0.35, answer: true, stake: 100, delta: 186 })).toBe("THE ORACLE SAID 35% YES · YOU TOOK YES FOR 100 · +186");
    expect(shareBigOneLine({ line: 0.35, answer: false, stake: 100, delta: -100 })).toBe("THE ORACLE SAID 35% YES · YOU TOOK NO FOR 100 · −100");
    expect(shareBigOneLine({ line: 0.35, answer: null, stake: null, delta: null })).toBe("THE ORACLE SAID 35% YES · YOU SAT IT OUT");
    expect(shareBigOneLine({ line: null, answer: true, stake: 100, delta: 186 })).toBeNull();
  });
  // Skia text has no wrapping, so the card breaks this line by hand.
  it("breaks the Big One's line on the last separator inside the measure", () => {
    expect(splitShareLine("THE ORACLE SAID 35% YES · YOU TOOK YES FOR 100 · +186"))
      .toEqual(["THE ORACLE SAID 35% YES", "YOU TOOK YES FOR 100 · +186"]);
    expect(splitShareLine("THE ORACLE SAID 35% YES · YOU SAT IT OUT"))
      .toEqual(["THE ORACLE SAID 35% YES · YOU SAT IT OUT", null]);
    // No separator within reach of the measure: printed whole rather than cut
    // mid-word, the way an ellipsis would.
    expect(splitShareLine("A".repeat(50))).toEqual(["A".repeat(50), null]);
  });

  it("composes the share message around the fortune delta", () => {
    expect(fortuneShareMessage({ date: "2026-09-10", delta: 140, fortuneAfter: 1140, results: ["win", "loss", "win", "win", "void"] }, null))
      .toBe("🔮 OUTSEEN 2026-09-10 — I✓ II✗ III✓ IV✓ V∅ · +140 · FORTUNE 1,140 · can you beat the house?");
    expect(fortuneShareMessage({ date: "2026-09-10", delta: -60, fortuneAfter: 940, results: ["loss", "loss", "loss", "loss", "loss"] }, "https://x.y"))
      .toBe("🔮 OUTSEEN 2026-09-10 — I✗ II✗ III✗ IV✗ V✗ · −60 · FORTUNE 940 · can you beat the house? https://x.y");
  });
});
