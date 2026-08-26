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

describe("hydrate", () => {
  it("marks server predictions sealed and overwrites divergent local state", () => {
    const s = useRoundStore.getState();
    s.setAnswer("q1", false); // local draft disagreeing with server truth
    useRoundStore.getState().setConfidence("q1", 95);
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true, confidence: 70 }]);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ answer: true, confidence: 70, sealed: true });
  });
  it("creates sealed entries for unknown questions and leaves others untouched", () => {
    useRoundStore.getState().setAnswer("q2", true);
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: false, confidence: 55 }]);
    const st = useRoundStore.getState().answers;
    expect(st["q1"]).toMatchObject({ answer: false, confidence: 55, sealed: true });
    expect(st["q2"]).toMatchObject({ answer: true, sealed: false });
  });
  it("keeps an existing idempotency key on hydrate", () => {
    useRoundStore.getState().setAnswer("q1", true);
    const key = useRoundStore.getState().answers["q1"]!.idempotencyKey;
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true, confidence: 75 }]);
    expect(useRoundStore.getState().answers["q1"]!.idempotencyKey).toBe(key);
  });
});
