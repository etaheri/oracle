import { describe, it, expect } from "vitest";
import { houseLines } from "../src/game/houseLine";

describe("the house headline (design §8.3)", () => {
  it("says nothing before any round has settled", () => {
    expect(houseLines(null)).toEqual([]);
    expect(houseLines(undefined)).toEqual([]);
    expect(houseLines({ total: 0, last_delta: null })).toEqual([]);
  });
  it("reports last night as a win or a loss for the house", () => {
    expect(houseLines({ total: 1240, last_delta: 1240 })).toEqual(["LAST NIGHT THE HOUSE WON 1,240"]);
    expect(houseLines({ total: 200, last_delta: -60 })).toEqual(["LAST NIGHT THE HOUSE LOST 60"]);
    expect(houseLines({ total: 0, last_delta: 0 })).toEqual(["LAST NIGHT THE HOUSE BROKE EVEN"]);
  });
  it("adds the debt line when the purse is negative", () => {
    expect(houseLines({ total: -1240, last_delta: -1240 })).toEqual(["LAST NIGHT THE HOUSE LOST 1,240", "THE ORACLE OWES ITS PLAYERS 1,240"]);
  });
});
