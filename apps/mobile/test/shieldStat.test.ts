import { describe, it, expect } from "vitest";
import { shieldStat } from "../src/game/shieldStat";

describe("shieldStat", () => {
  it("formats every reserve state in machine voice", () => {
    expect(shieldStat(true, 0)).toBe("1 FREE");
    expect(shieldStat(true, 2)).toBe("1 FREE + 2 PAID");
    expect(shieldStat(false, 1)).toBe("1 PAID");
    expect(shieldStat(false, 0)).toBe("NONE UNTIL NEXT MONTH");
  });
});
