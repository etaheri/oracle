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
