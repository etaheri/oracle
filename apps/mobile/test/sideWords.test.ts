import { describe, it, expect } from "vitest";
import { sideWord, outcomeWord, shareSoFar } from "../src/game/sideWords";

describe("the side words (design 2026-09-25 N1, §7)", () => {
  it("agrees and disagrees on a hot take, and keeps yes and no on a market question", () => {
    expect(sideWord(true, true)).toBe("AGREE");
    expect(sideWord(false, true)).toBe("DISAGREE");
    expect(sideWord(true, false)).toBe("YES");
    expect(sideWord(false, false)).toBe("NO");
  });
  it("names the outcome in the past tense on a hot take", () => {
    expect(outcomeWord("yes", true)).toBe("AGREED");
    expect(outcomeWord("no", true)).toBe("DISAGREED");
    expect(outcomeWord("yes", false)).toBe("YES");
    expect(outcomeWord("no", false)).toBe("NO");
  });
  it("prints the share so far", () => {
    expect(shareSoFar(62, true)).toBe("62% AGREE");
    expect(shareSoFar(62, false)).toBe("62% SAY YES");
  });
});
