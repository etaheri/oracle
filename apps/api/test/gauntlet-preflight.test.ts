import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { preflight } from "../src/pipeline/gauntlet/preflight";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import type { Candidate } from "../src/pipeline/candidate";
import type { PipelineDeps } from "../src/pipeline";

const cand = (text: string, key: string): Candidate => ({
  category: "news", text, resolution_criteria: "per the page",
  source_name: "SRC", source_url: "https://example.com/x", author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: key,
});
const judged = (text: string, key: string): Judged => ({ candidate: cand(text, key), criticProbability: 0.5 });

// askResolver puts the candidate's text in the SYSTEM prompt, not the user
// message (resolver.ts's `user` is a fixed "resolve this now" string) — so
// per-candidate fixtures below must branch on `call.system`, not `call.user`.
function deps(db: PipelineDeps["db"], reply: (system: string) => unknown): PipelineDeps {
  return {
    db,
    telegram: { send: async () => {} },
    claude: { structured: async (call) => reply(call.system) },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
  };
}

const UNVERIFIABLE = { outcome: "unverifiable", quotes: [], reasoning: "not yet" };
const ANSWERED = { outcome: "yes", quotes: [{ url: "https://example.com/x", quote: "it happened" }], reasoning: "done" };

describe("preflight — tier 3, the inversion", () => {
  it("passes a candidate the resolver CANNOT answer, which is the requirement", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(deps(db, () => UNVERIFIABLE), [judged("Will it?", "k1")]);
    expect(r.passed).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  // THE TRIPWIRE. If this test can be made to pass while the fake resolver
  // answers YES, the inversion has been implemented backwards and every
  // already-answered question in the world is eligible for tomorrow's round.
  it("REJECTS a candidate the resolver can already answer — it was never a prediction", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(deps(db, () => ANSWERED), [judged("Will it?", "k1")]);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("already-resolvable");
    expect(r.rejected[0]!.detail).toContain("yes");
  });

  it("passes a ruling that arrived with no receipts — a resolver that cannot quote has not answered", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(deps(db, () => ({ outcome: "yes", quotes: [], reasoning: "vibes" })), [judged("Will it?", "k1")]);
    expect(r.passed).toHaveLength(1);
  });

  it("judges each candidate on its own call", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(
      deps(db, (system) => (system.includes("A?") ? ANSWERED : UNVERIFIABLE)),
      [judged("A?", "k1"), judged("B?", "k2")],
    );
    expect(r.passed.map((j) => j.candidate.text)).toEqual(["B?"]);
    expect(r.rejected.map((x) => x.text)).toEqual(["A?"]);
  });

  it("carries the critic's probability through untouched", async () => {
    const { db } = await makeTestDb();
    const j: Judged = { candidate: cand("Will it?", "k1"), criticProbability: 0.43 };
    const r = await preflight(deps(db, () => UNVERIFIABLE), [j]);
    expect(r.passed[0]!.criticProbability).toBe(0.43);
  });

  it("uses the preflight model, not the resolution model", async () => {
    const { db } = await makeTestDb();
    let model = "";
    const d = deps(db, () => UNVERIFIABLE);
    d.claude = { structured: async (call) => { model = call.model; return UNVERIFIABLE; } };
    await preflight(d, [judged("Will it?", "k1")]);
    expect(model).toBe("m-p");
  });
});
