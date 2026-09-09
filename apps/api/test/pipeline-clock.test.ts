import { describe, expect, it } from "vitest";
import { addDays, etNow, noonET, fastResolveBy, voidDeadline } from "../src/pipeline/clock";
import { CONSTANTS } from "@oracle/core";

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

describe("fastResolveBy / voidDeadline (design 2026-09-09 §1)", () => {
  it("fast-by is the lock plus the evening lag", () => {
    // lock for 2026-08-27 is noon ET 2026-08-28 = 16:00Z (EDT)
    const expected = new Date("2026-08-28T16:00:00Z").getTime() + CONSTANTS.EVENING_RESOLVE_LAG_HOURS * 3_600_000;
    expect(fastResolveBy("2026-08-27").getTime()).toBe(expected);
  });
  it("void deadline is noon ET two days after the round date", () => {
    expect(voidDeadline("2026-08-27").toISOString()).toBe("2026-08-29T16:00:00.000Z");
  });
  it("void deadline respects standard time", () => {
    expect(voidDeadline("2026-01-15").toISOString()).toBe("2026-01-17T17:00:00.000Z");
  });
});
