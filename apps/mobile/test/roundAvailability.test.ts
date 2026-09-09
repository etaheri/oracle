import { it, expect } from "vitest";
import { roundAvailability } from "../src/game/roundAvailability";
import { confidenceMeaning } from "../src/game/confidence";
it("distinguishes an unanswered expiry from an already sealed question", () => {
  const qs = [{ id: "a", locks_at: "2026-09-07T15:00:00Z" }];
  const now = Date.parse(qs[0].locks_at);
  expect(roundAvailability(qs, new Set(), now).completeStillPossible).toBe(false);
  expect(roundAvailability(qs, new Set(["a"]), now).missedCount).toBe(0);
  expect(roundAvailability(qs, new Set(), now - 1).openCount).toBe(1);
  expect(confidenceMeaning(95)).toBe("ALMOST CERTAIN");
});

it("does not count a version 2 healed lock as a player miss", () => {
  const qs = [
    { id: "void", locks_at: "2026-09-07T14:00:00Z", struck: true },
    { id: "missed", locks_at: "2026-09-07T14:00:00Z", struck: false },
    { id: "open", locks_at: "2026-09-07T16:00:00Z", struck: false },
  ];
  expect(roundAvailability(qs, new Set(), Date.parse("2026-09-07T15:00:00Z"), 2)).toMatchObject({
    openCount: 1,
    missedCount: 1,
    voidCount: 1,
  });
});

it("counts a withdrawn (struck) question as void at v2 and never as missed", () => {
  const qs = [
    { id: "a", locks_at: "2026-09-07T14:00:00Z", struck: true },
    { id: "b", locks_at: "2026-09-07T16:00:00Z", struck: false },
    { id: "c", locks_at: "2026-09-07T16:00:00Z", struck: false },
    { id: "d", locks_at: "2026-09-07T16:00:00Z", struck: false },
    { id: "e", locks_at: "2026-09-07T16:00:00Z", struck: false },
  ];
  const r = roundAvailability(qs, new Set(), Date.parse("2026-09-07T15:00:00Z"), 2);
  expect(r.voidCount).toBe(1);
  expect(r.missedCount).toBe(0);
  expect(r.completeStillPossible).toBe(true);
});
