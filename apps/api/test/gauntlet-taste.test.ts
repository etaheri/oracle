import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { tasteCheck } from "../src/pipeline/gauntlet/taste";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import type { PipelineDeps } from "../src/pipeline";

const judged = (text: string, key: string): Judged => ({
  candidate: {
    category: "news", text, resolution_criteria: "per the page", source_name: "SRC",
    source_url: "https://example.com/x", author_probability: 0.5, market_prob: null,
    resolves_at: "2026-09-05T14:00:00Z", topic_key: key,
  },
  criticProbability: 0.5,
});

function deps(db: PipelineDeps["db"], structured: PipelineDeps["claude"]): PipelineDeps {
  return {
    db,
    telegram: { send: async () => {} },
    claude: structured,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
  };
}
const reply = (r: unknown): PipelineDeps["claude"] => ({ structured: async () => r });

const batch = [judged("A?", "k1"), judged("B?", "k2")];

describe("tasteCheck — tier 4", () => {
  it("passes candidates the gate allows", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: true, reason: "" }] })), batch);
    expect(r.passed).toHaveLength(2);
    expect(r.rejected).toHaveLength(0);
  });

  it("removes only the candidate it disallows", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: [{ index: 0, allowed: false, reason: "a named person's medical outcome" }, { index: 1, allowed: true, reason: "" }] })), batch);
    expect(r.passed.map((j) => j.candidate.text)).toEqual(["B?"]);
    expect(r.rejected[0]!.reason).toBe("taste");
    expect(r.rejected[0]!.detail).toContain("medical");
  });

  // FAIL-CLOSED, one test per failure mode. A fail-closed gate that has only
  // been tested on the success path is not known to be fail-closed.
  it("rejects the WHOLE batch when the call throws", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, { structured: async () => { throw new Error("boom"); } }), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected.every((x) => x.reason === "taste")).toBe(true);
  });

  it("rejects the WHOLE batch when the call times out", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, { structured: async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); } }), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("rejects the WHOLE batch when the output cannot be parsed", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: "not an array" })), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("rejects the WHOLE batch when a verdict is missing — a silent gap is a failure, not a pass", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: [{ index: 0, allowed: true, reason: "" }] })), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("returns an empty result for an empty batch without calling the model", async () => {
    const { db } = await makeTestDb();
    let called = false;
    const r = await tasteCheck(deps(db, { structured: async () => { called = true; return {}; } }), []);
    expect(called).toBe(false);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });

  it("asks for no web search — this is classification, not research", async () => {
    const { db } = await makeTestDb();
    let sawSearch: unknown = "unset";
    const d = deps(db, { structured: async (call) => { sawSearch = call.webSearch; return { verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: true, reason: "" }] }; } });
    await tasteCheck(d, batch);
    expect(sawSearch).toBeUndefined();
  });
});
