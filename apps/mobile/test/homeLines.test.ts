import { describe, it, expect } from "vitest";
import { partialLine, spokenLine, riskLine, lapseNotice } from "../src/game/homeLines";

describe("homeLines", () => {
  it("partialLine names the count and the rule, only for a partial day", () => {
    expect(partialLine(3, 5)).toBe("III OF V SEALED · A COMPETITIVE RESULT REQUIRES EVERY NON-VOID QUESTION. YOUR CALLS CAN STILL RECEIVE RESULTS.");
    expect(partialLine(0, 5)).toBeNull();
    expect(partialLine(5, 5)).toBeNull();
  });
  it("spokenLine counts players without calling them oracles", () => {
    expect(spokenLine(142)).toBe("142 PLAYERS HAVE MADE THEIR CALLS");
    expect(spokenLine(1)).toBe("1 PLAYER HAS MADE A CALL");
    expect(spokenLine(0)).toBe("MAKE THE FIRST CALL");
  });
  it("riskLine warns inside three hours of lock, unsealed, with a vigil to lose", () => {
    expect(riskLine(4, false, 2 * 3_600_000, "k")).toBe("YOUR STREAK: 4 DAYS. ONE SEALED CALL KEEPS IT GOING WHEN THE ROUND SETTLES.");
    expect(riskLine(4, true, 2 * 3_600_000, "k")).toBeNull();
    expect(riskLine(0, false, 2 * 3_600_000, "k")).toBeNull();
    expect(riskLine(1, false, 2 * 3_600_000, "k")).toBeNull(); // the oracle starts counting at 2
    expect(riskLine(4, false, 4 * 3_600_000, "k")).toBeNull();
    expect(riskLine(4, false, null, "k")).toBeNull();
  });
  it("lapseNotice speaks once the vigil is broken and yesterday went unplayed", () => {
    const l = lapseNotice(6, 0, false, "2026-08-28");
    expect(l).toBe(l?.toUpperCase());
    expect(lapseNotice(6, 0, false, "2026-08-28")).toBe(l); // deterministic
    expect(lapseNotice(0, 0, false, "k")).toBeNull();   // brand-new player: nothing lapsed
    expect(lapseNotice(6, 3, false, "k")).toBeNull();   // shield held / vigil alive
    expect(lapseNotice(6, 0, true, "k")).toBeNull();    // played yesterday
    expect(lapseNotice(6, 0, null, "k")).toBeNull();    // unknown
  });
});
