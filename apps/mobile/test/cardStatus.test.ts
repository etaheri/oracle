import { describe, it, expect } from "vitest";
import { cardStatus } from "../src/game/cardStatus";

const NOW = Date.parse("2026-09-01T12:00:00Z");

describe("cardStatus", () => {
  it("reports a sealed card regardless of the clock", () => {
    expect(cardStatus("2026-09-01T16:12:09Z", NOW, true)).toBe("ST: SEALED");
    expect(cardStatus(null, NOW, true)).toBe("ST: SEALED");
  });

  it("counts down to the lock while the card is open", () => {
    expect(cardStatus("2026-09-01T16:12:09Z", NOW, false)).toBe("LOCK 4:12:09");
  });

  it("drops the hour segment inside the last hour", () => {
    expect(cardStatus("2026-09-01T12:04:30Z", NOW, false)).toBe("LOCK 04:30");
  });

  it("reads OPEN when there is no lock to count down to", () => {
    expect(cardStatus(null, NOW, false)).toBe("ST: OPEN");
  });

  it("reads OPEN once the lock has passed, never a negative countdown", () => {
    expect(cardStatus("2026-09-01T11:59:00Z", NOW, false)).toBe("ST: OPEN");
  });

  it("reads OPEN on an unparseable timestamp rather than throwing", () => {
    expect(cardStatus("not-a-date", NOW, false)).toBe("ST: OPEN");
  });
});
