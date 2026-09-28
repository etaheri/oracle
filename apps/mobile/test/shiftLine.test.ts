import { describe, it, expect } from "vitest";
import { shiftLine, FLOOR_DARK } from "../src/game/shiftLine";

const live = { open: true, allSealed: false, room: true, councilCommittedAt: "2026-09-28T13:00:00.000Z" };

describe("Home's shift clock (design 2026-09-25 §6.5)", () => {
  it("says the machines are online and when they clocked in, in eastern time", () => {
    expect(shiftLine(live)).toBe("3 MACHINES ONLINE · CLOCKED IN 09:00");
    expect(shiftLine({ ...live, councilCommittedAt: "2026-09-28T13:07:00.000Z" })).toBe("3 MACHINES ONLINE · CLOCKED IN 09:07");
  });
  it("says the floor is dark when the round opened without them", () => {
    expect(FLOOR_DARK).toBe("THE FLOOR IS DARK · THE MACHINES DID NOT CLOCK IN");
    expect(shiftLine({ ...live, councilCommittedAt: null })).toBe(FLOOR_DARK);
  });
  it("says nothing between rounds, once every take is sealed, or on a market round", () => {
    expect(shiftLine({ ...live, open: false })).toBeNull();
    expect(shiftLine({ ...live, allSealed: true })).toBeNull();
    expect(shiftLine({ ...live, room: false })).toBeNull();
  });
});
