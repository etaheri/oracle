import { describe, expect, it } from "vitest";
import { readingSlot } from "../src/game/readingSlot";

describe("readingSlot (design 2026-09-09 §2.2, §3.1)", () => {
  it("is none without a reading round", () => {
    expect(readingSlot(null, null)).toEqual({ kind: "none" });
    expect(readingSlot(undefined, "2026-09-09")).toEqual({ kind: "none" });
  });
  it("is in play once at least one question is decided in a locked round", () => {
    expect(readingSlot({ date: "2026-09-09", settled: false, decided: 3, total: 5 }, null)).toEqual({
      kind: "inPlay", date: "2026-09-09", line: "IN PLAY · 3 DECIDED · 2 PENDING", cta: "SEE WHAT IS DECIDED",
    });
  });
  it("is none for a locked round with nothing decided yet", () => {
    expect(readingSlot({ date: "2026-09-09", settled: false, decided: 0, total: 5 }, null)).toEqual({ kind: "none" });
  });
  it("is none once every question is decided but the round has not yet settled (settle lands within a tick)", () => {
    expect(readingSlot({ date: "2026-09-09", settled: false, decided: 5, total: 5 }, null)).toEqual({ kind: "none" });
  });
  it("is settled until the reveal has been seen", () => {
    expect(readingSlot({ date: "2026-09-09", settled: true, decided: 5, total: 5 }, "2026-09-08")).toEqual({
      kind: "settled", date: "2026-09-09", line: "THE LEDGER IS READ", cta: "READ THE LEDGER",
    });
    expect(readingSlot({ date: "2026-09-09", settled: true, decided: 5, total: 5 }, "2026-09-09")).toEqual({ kind: "none" });
  });
  it("keeps the in-play state visible even after a partial reveal was seen (seen is a settled concept)", () => {
    expect(readingSlot({ date: "2026-09-09", settled: false, decided: 4, total: 5 }, "2026-09-09").kind).toBe("inPlay");
  });
});
