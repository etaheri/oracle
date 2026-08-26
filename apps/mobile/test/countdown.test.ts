import { describe, it, expect } from "vitest";
import { formatCountdown, msUntil } from "../src/game/countdown";

describe("msUntil", () => {
  it("is null for null, invalid, or past timestamps", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    expect(msUntil(null, now)).toBeNull();
    expect(msUntil("not-a-date", now)).toBeNull();
    expect(msUntil("2026-08-26T11:59:59Z", now)).toBeNull();
  });
  it("returns remaining ms for future timestamps", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    expect(msUntil("2026-08-26T13:30:05Z", now)).toBe((90 * 60 + 5) * 1000);
  });
});

describe("formatCountdown", () => {
  it("formats h:mm:ss", () => {
    expect(formatCountdown((2 * 3600 + 14 * 60 + 9) * 1000)).toBe("2:14:09");
  });
  it("drops the hour field under an hour", () => {
    expect(formatCountdown((14 * 60 + 9) * 1000)).toBe("14:09");
    expect(formatCountdown(5000)).toBe("00:05");
  });
});
