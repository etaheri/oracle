import { describe, expect, it } from "vitest";
import { homeDates } from "../src/game/homeDates";

describe("homeDates (audit finding A: shield/lapse need calendar yesterday, the rail needs the reading date)", () => {
  it("splits the ledger's reading date from calendar yesterday of the round when they diverge", () => {
    const result = homeDates("2026-09-05", "2026-09-08");
    expect(result.calendarYesterday).toBe("2026-09-07");
    expect(result.ledgerDate).toBe("2026-09-05");
  });

  it("falls back to calendar yesterday of the round for both when there is no reading", () => {
    const result = homeDates(null, "2026-09-08");
    expect(result.calendarYesterday).toBe("2026-09-07");
    expect(result.ledgerDate).toBe("2026-09-07");
  });

  it("falls back to calendar yesterday of now for both when there is no round date either", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    const result = homeDates(undefined, undefined, now);
    expect(result.calendarYesterday).toBe("2026-09-07");
    expect(result.ledgerDate).toBe("2026-09-07");
  });
});
