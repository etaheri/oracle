import { describe, it, expect } from "vitest";
import { isClosed, nextOpenQuestion } from "../src/game/questionState";

const q = (slot: number, locks_at: string) => ({ id: `q${slot}`, slot, locks_at });
const NOW = Date.parse("2026-08-28T01:00:00Z");

describe("questionState", () => {
  it("a question is closed once its lock has passed", () => {
    expect(isClosed(q(1, "2026-08-28T00:00:00Z"), NOW)).toBe(true);
    expect(isClosed(q(1, "2026-08-28T16:00:00Z"), NOW)).toBe(false);
  });
  it("the next card is the first unsealed, still-open slot", () => {
    const qs = [q(3, "2026-08-28T16:00:00Z"), q(1, "2026-08-28T16:00:00Z"), q(2, "2026-08-28T00:00:00Z")];
    expect(nextOpenQuestion(qs, (id) => id === "q1", NOW)?.slot).toBe(3); // q2 closed, q1 sealed
    expect(nextOpenQuestion(qs, () => true, NOW)).toBeUndefined();
  });
});
