import { describe, it, expect, beforeEach } from "vitest";
import { useRoundStore } from "../src/game/roundStore";

beforeEach(() => useRoundStore.getState().reset());

describe("roundStore", () => {
  it("initializes confidence at 75 on first answer", () => {
    useRoundStore.getState().setAnswer("q1", true);
    const a = useRoundStore.getState().answers["q1"]!;
    expect(a).toMatchObject({ answer: true, confidence: 75, sealed: false });
    expect(a.idempotencyKey).toContain("q1:");
  });
  it("keeps confidence and key when flipping answer", () => {
    const s = useRoundStore.getState();
    s.setAnswer("q1", true);
    s.setConfidence("q1", 90);
    const key = useRoundStore.getState().answers["q1"]!.idempotencyKey;
    useRoundStore.getState().setAnswer("q1", false);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ answer: false, confidence: 90, idempotencyKey: key });
  });
  it("markSealed locks the entry", () => {
    useRoundStore.getState().setAnswer("q1", true);
    useRoundStore.getState().markSealed("q1");
    expect(useRoundStore.getState().answers["q1"]!.sealed).toBe(true);
  });
});
