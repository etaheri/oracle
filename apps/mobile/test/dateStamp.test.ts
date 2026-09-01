import { describe, expect, it } from "vitest";
import { dateStamp } from "../src/game/dateStamp";

describe("dateStamp", () => {
  it("punctuates an ISO date with middots", () => {
    expect(dateStamp("2026-09-01")).toBe("2026·09·01");
  });

  it("ignores a time suffix", () => {
    expect(dateStamp("2026-12-25T17:00:00Z")).toBe("2026·12·25");
  });

  it("pads a loosely written date", () => {
    expect(dateStamp("2026-9-1")).toBe("2026·09·01");
  });

  it("renders nothing rather than garbage for a malformed date", () => {
    expect(dateStamp("")).toBe("");
    expect(dateStamp("not-a-date")).toBe("");
    expect(dateStamp("2026-09")).toBe("");
  });
});
