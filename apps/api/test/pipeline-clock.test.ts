import { describe, expect, it } from "vitest";
import { addDays, etNow, noonET } from "../src/pipeline/clock";

describe("etNow", () => {
  it("converts UTC instants to ET wall clock (EDT)", () => {
    // 2026-08-27 is daylight time: ET = UTC-4
    expect(etNow(new Date("2026-08-27T16:10:00Z"))).toEqual({ date: "2026-08-27", hour: 12, minute: 10 });
  });
  it("converts in standard time (EST)", () => {
    // 2026-01-15 is standard time: ET = UTC-5
    expect(etNow(new Date("2026-01-15T17:00:00Z"))).toEqual({ date: "2026-01-15", hour: 12, minute: 0 });
  });
  it("crosses the date line correctly", () => {
    expect(etNow(new Date("2026-08-28T02:00:00Z")).date).toBe("2026-08-27");
  });
  it("never yields hour 24 at ET midnight", () => {
    expect(etNow(new Date("2026-08-27T04:00:00Z")).hour).toBe(0);
  });
});

describe("noonET", () => {
  it("is 16:00Z in daylight time", () => {
    expect(noonET("2026-08-27").toISOString()).toBe("2026-08-27T16:00:00.000Z");
  });
  it("is 17:00Z in standard time", () => {
    expect(noonET("2026-01-15").toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
  it("handles the spring-forward date", () => {
    // 2026-03-08: DST begins 2:00 ET; noon that day is already EDT
    expect(noonET("2026-03-08").toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });
});

describe("addDays", () => {
  it("adds and subtracts across month ends", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });
});
