import { describe, it, expect } from "vitest";
import { roomRows, ROOM_READ_LABEL, ROOM_MISSED_LABEL } from "../src/game/roomRecord";

const room = (days: number, read: number, missed: number) => ({ days, days_read: read, days_machines_missed: missed, read_rate_30d: null, calls_30d: 0 });

describe("the record's room rows (design 2026-09-25 §6.4)", () => {
  it("names the two rows", () => {
    expect(ROOM_READ_LABEL).toBe("READ THE ROOM");
    expect(ROOM_MISSED_LABEL).toBe("THE MACHINES MISSED");
  });
  it("counts both out of the same days", () => {
    expect(roomRows(room(9, 6, 3))).toEqual({ read: "6 OF 9 DAYS", missed: "3 OF 9", verdict: "YOU READ THE ROOM BETTER THAN THE MACHINES", gold: true });
    expect(roomRows(room(1, 1, 0))!.read).toBe("1 OF 1 DAY");
  });
  it("gives the machines the line when they missed more days than the caller read", () => {
    expect(roomRows(room(9, 2, 5))).toMatchObject({ verdict: "THE MACHINES READ IT BETTER", gold: false });
  });
  it("says nothing when the two are level", () => {
    expect(roomRows(room(9, 4, 4))).toMatchObject({ verdict: null, gold: false });
  });
  it("has no rows before the first settled hot take, or from an older server", () => {
    expect(roomRows(room(0, 0, 0))).toBeNull();
    expect(roomRows(null)).toBeNull();
    expect(roomRows(undefined)).toBeNull();
  });
});
