import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { tasteTexts } from "../src/pipeline/taste";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";
import { BudgetExhausted } from "../src/pipeline/spend";

function deps(db: PipelineDeps["db"], structured: PipelineDeps["claude"]): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    telegram: { send: async () => {} },
    claude: structured,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    now: () => new Date("2026-09-04T22:00:00Z"),
  };
}
const reply = (r: unknown): PipelineDeps["claude"] => ({ structured: async () => r });

const batch = ["A?", "B?"];

describe("tasteTexts — the fail-closed gate", () => {
  it("passes candidates the gate allows", async () => {
    const { db } = await makeTestDb();
    const r = await tasteTexts(deps(db, reply({ verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: true, reason: "" }] })), batch);
    expect(r.allowed).toEqual([true, true]);
    expect(r.detail).toBeNull();
  });

  it("removes only the candidate it disallows", async () => {
    const { db } = await makeTestDb();
    const r = await tasteTexts(deps(db, reply({ verdicts: [{ index: 0, allowed: false, reason: "a named person's medical outcome" }, { index: 1, allowed: true, reason: "" }] })), batch);
    expect(r.allowed).toEqual([false, true]);
    expect(r.reasons[0]).toContain("medical");
    expect(r.detail).toBeNull();
  });

  // FAIL-CLOSED, one test per failure mode. A fail-closed gate that has only
  // been tested on the success path is not known to be fail-closed. A refused
  // batch is `allowed` all false WITH a non-null `detail` — the detail is what
  // distinguishes an infrastructure refusal from a gate that judged and said no.
  it("rejects the WHOLE batch when the call throws", async () => {
    const { db } = await makeTestDb();
    const r = await tasteTexts(deps(db, { structured: async () => { throw new Error("boom"); } }), batch);
    expect(r.allowed).toEqual([false, false]);
    expect(r.detail).toContain("could not be reached");
  });

  it("rejects the WHOLE batch when the call times out", async () => {
    const { db } = await makeTestDb();
    const r = await tasteTexts(deps(db, { structured: async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); } }), batch);
    expect(r.allowed).toEqual([false, false]);
    expect(r.detail).not.toBeNull();
  });

  it("rejects the WHOLE batch when the output cannot be parsed", async () => {
    const { db } = await makeTestDb();
    const r = await tasteTexts(deps(db, reply({ verdicts: "not an array" })), batch);
    expect(r.allowed).toEqual([false, false]);
    expect(r.detail).toMatch(/could not be read/);
  });

  it("rejects the WHOLE batch when a verdict is missing — a silent gap is a failure, not a pass", async () => {
    const { db } = await makeTestDb();
    const r = await tasteTexts(deps(db, reply({ verdicts: [{ index: 0, allowed: true, reason: "" }] })), batch);
    expect(r.allowed).toEqual([false, false]);
    expect(r.detail).toMatch(/did not judge every candidate/);
  });

  it("returns an empty result for an empty batch without calling the model", async () => {
    const { db } = await makeTestDb();
    let called = false;
    const r = await tasteTexts(deps(db, { structured: async () => { called = true; return {}; } }), []);
    expect(called).toBe(false);
    expect(r.allowed).toEqual([]);
    expect(r.detail).toBeNull();
  });

  it("lets a spent budget through instead of failing the batch closed", async () => {
    const { db } = await makeTestDb();
    const d = deps(db, { structured: async () => { throw new BudgetExhausted("2026-09-04", 151, true); } });
    // A day-level stop must PROPAGATE. Converting it to a refused batch makes
    // the night end silently with no critical alert — the defect this test pins.
    await expect(tasteTexts(d, batch)).rejects.toBeInstanceOf(BudgetExhausted);
  });

  it("still fails closed on any other error, even after the BudgetExhausted carve-out", async () => {
    const { db } = await makeTestDb();
    const d = deps(db, { structured: async () => { throw new Error("429 rate limited"); } });
    const r = await tasteTexts(d, batch);
    expect(r.allowed).toEqual([false, false]);
    expect(r.detail).toContain("429");
  });

  it("judges plain strings and fails closed on an unreadable reply", async () => {
    const { db } = await makeTestDb();
    const good = await tasteTexts(
      deps(db, reply({ verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: false, reason: "private individual" }] })),
      ["Will it rain?", "Will my neighbour move?"],
    );
    expect(good).toEqual({ allowed: [true, false], reasons: ["", "private individual"], detail: null });
    const bad = await tasteTexts(deps(db, reply({ nope: true })), ["Will it rain?"]);
    expect(bad.allowed).toEqual([false]);
    expect(bad.reasons).toEqual([""]);
    expect(bad.detail).toMatch(/could not be read/);
  });

  it("asks for no web search — this is classification, not research", async () => {
    const { db } = await makeTestDb();
    let sawSearch: unknown = "unset";
    const d = deps(db, { structured: async (call) => { sawSearch = call.webSearch; return { verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: true, reason: "" }] }; } });
    await tasteTexts(d, batch);
    expect(sawSearch).toBeUndefined();
  });
});
