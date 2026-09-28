import { describe, it, expect } from "vitest";
import { logIndex } from "../src/game/todayLog";

const A = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const line = { at: "2026-09-25T13:00:00.000Z", kind: "say" as const, member: "haiku" as const, text: "no chance", p_yes: 0.31, tone: "mute" as const };

describe("the log after the seal (design 2026-09-25 §6.2)", () => {
  it("indexes the sealed questions by id", () => {
    const index = logIndex({ questions: [{ question_id: A, line_p_yes: 0.38, log: [line] }] });
    expect(index.get(A)).toEqual({ line: 0.38, log: [line] });
    expect(index.get("unsealed")).toBeUndefined();
  });
  it("is empty before the first seal, and when there is no open round", () => {
    expect(logIndex(undefined).size).toBe(0);
    expect(logIndex(null).size).toBe(0);
  });
});
