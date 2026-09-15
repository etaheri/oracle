import { describe, it, expect, beforeEach } from "vitest";
import { useRoundStore } from "../src/game/roundStore";

beforeEach(() => useRoundStore.getState().reset());

describe("roundStore", () => {
  it("opens an entry unsealed and unstaked on first answer", () => {
    useRoundStore.getState().setAnswer("q1", true);
    const a = useRoundStore.getState().answers["q1"]!;
    expect(a).toMatchObject({ answer: true, sealed: false, stake: null, doubled: false });
    expect(a.idempotencyKey).toContain("q1:");
  });
  it("keeps the key when flipping answer", () => {
    useRoundStore.getState().setAnswer("q1", true);
    const key = useRoundStore.getState().answers["q1"]!.idempotencyKey;
    useRoundStore.getState().setAnswer("q1", false);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ answer: false, idempotencyKey: key });
  });
  it("markSealed locks the entry", () => {
    useRoundStore.getState().setAnswer("q1", true);
    useRoundStore.getState().markSealed("q1", null);
    expect(useRoundStore.getState().answers["q1"]!.sealed).toBe(true);
  });
  it("setAtSeal attaches the crowd-at-seal snapshot without touching sealed or answer", () => {
    useRoundStore.getState().setAnswer("q1", true);
    useRoundStore.getState().markSealed("q1", null);
    useRoundStore.getState().setAtSeal("q1", { pct: 40, count: 12 });
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ answer: true, sealed: true, atSeal: { pct: 40, count: 12 } });
  });
  it("setAtSeal is a no-op for a question with no local entry", () => {
    useRoundStore.getState().setAtSeal("qUnknown", { pct: 40, count: 12 });
    expect(useRoundStore.getState().answers["qUnknown"]).toBeUndefined();
  });
});

describe("hydrate", () => {
  it("marks server predictions sealed and overwrites divergent local state", () => {
    useRoundStore.getState().setAnswer("q1", false);
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true, stake: 50, doubled: false }]);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ answer: true, sealed: true, stake: 50, doubled: false });
  });
  it("carries the doubled stake from the server", () => {
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true, stake: 100, doubled: true }]);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ stake: 100, doubled: true });
  });
  it("creates sealed entries for unknown questions and leaves others untouched", () => {
    useRoundStore.getState().setAnswer("q2", true);
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: false }]);
    const st = useRoundStore.getState().answers;
    expect(st["q1"]).toMatchObject({ answer: false, sealed: true, stake: null, doubled: false });
    expect(st["q2"]).toMatchObject({ answer: true, sealed: false });
  });
  it("keeps an existing idempotency key on hydrate", () => {
    useRoundStore.getState().setAnswer("q1", true);
    const key = useRoundStore.getState().answers["q1"]!.idempotencyKey;
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true }]);
    expect(useRoundStore.getState().answers["q1"]!.idempotencyKey).toBe(key);
  });
  it("preserves the crowd-at-seal snapshot across a later hydrate — hydrate does not own that field", () => {
    useRoundStore.getState().setAnswer("q1", true);
    useRoundStore.getState().markSealed("q1", 50);
    useRoundStore.getState().setAtSeal("q1", { pct: 40, count: 12 });
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true }]);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ sealed: true, atSeal: { pct: 40, count: 12 } });
  });
  it("markSealed records the server's stake", () => {
    useRoundStore.getState().setAnswer("q1", true);
    useRoundStore.getState().markSealed("q1", 50);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ sealed: true, stake: 50 });
  });
});
