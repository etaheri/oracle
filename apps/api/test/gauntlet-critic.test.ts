import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { criticize, CONTESTED_MAX_DELTA, PROB_DISAGREEMENT_MAX } from "../src/pipeline/gauntlet/critic";
import type { Candidate } from "../src/pipeline/candidate";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  category: "news", text: "Will it happen?", resolution_criteria: "per the page",
  source_name: "SRC", source_url: "https://example.com/x", author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: "topic-one", ...o,
});

const verdict = (index: number, o: Record<string, unknown> = {}) => ({
  index, readable_two_ways: false, criteria_determine_outcome: true,
  resolves_at_plausible: true, critic_probability: 0.5, reasons: [], ...o,
});

function deps(db: PipelineDeps["db"], reply: unknown, seen: { user?: string } = {}): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    telegram: { send: async () => {} },
    claude: { structured: async (call) => { seen.user = call.user; return reply; } },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
  };
}

describe("criticize — tier 2", () => {
  it("never shows the critic the author's own probability", async () => {
    const { db } = await makeTestDb();
    const seen: { user?: string } = {};
    await criticize(deps(db, { verdicts: [verdict(0)] }, seen), [cand({ author_probability: 0.42 })]);
    expect(seen.user).not.toContain("0.42");
    expect(seen.user!.toLowerCase()).not.toContain("author_probability");
  });

  it("passes a candidate the critic finds sound and contested", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: 0.55 })] }), [cand()]);
    expect(r.passed).toHaveLength(1);
    expect(r.judged[0]!.criticProbability).toBe(0.55);
  });

  it("rejects a candidate two careful people could read differently", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { readable_two_ways: true })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects criteria that do not determine the outcome", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { criteria_determine_outcome: false })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects an implausible resolves_at", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { resolves_at_plausible: false })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects an uncontested candidate — the critic's own number outside the band", async () => {
    const { db } = await makeTestDb();
    const outside = 0.5 + CONTESTED_MAX_DELTA + 0.01;
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: outside })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("uncontested");
  });

  it("keeps a candidate exactly at the edge of the band", async () => {
    const { db } = await makeTestDb();
    const edge = 0.5 + CONTESTED_MAX_DELTA;
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: edge })] }), [cand({ author_probability: 0.7 })]);
    expect(r.passed).toHaveLength(1);
  });

  it("rejects when the two readings are too far apart, which usually means the sentence is ambiguous", async () => {
    const { db } = await makeTestDb();
    // 0.31 vs 0.69 is 0.38 apart: both inside the contested band, both
    // reasonable on their own, and a gap that says the sentence is not one
    // sentence. This is a DISTINCT failure from either estimate being extreme.
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: 0.69 })] }), [cand({ author_probability: 0.31 })]);
    expect(0.69 - 0.31).toBeGreaterThan(PROB_DISAGREEMENT_MAX);
    expect(r.rejected[0]!.reason).toBe("uncontested");
    expect(r.rejected[0]!.detail).toContain("apart");
  });

  it("rejects every candidate the critic did not return a verdict for", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0)] }), [cand({ text: "A?" }), cand({ text: "B?", topic_key: "topic-two" })]);
    expect(r.passed.map((c) => c.text)).toEqual(["A?"]);
    expect(r.rejected[0]!.text).toBe("B?");
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects the whole batch when the response cannot be parsed — no candidate is judged sound by default", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { nonsense: true }), [cand(), cand({ text: "B?", topic_key: "topic-two" })]);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("makes exactly one model call for the whole set", async () => {
    const { db } = await makeTestDb();
    let calls = 0;
    const d = deps(db, { verdicts: [verdict(0), verdict(1)] });
    d.claude = { structured: async () => { calls++; return { verdicts: [verdict(0), verdict(1)] }; } };
    await criticize(d, [cand({ text: "A?" }), cand({ text: "B?", topic_key: "topic-two" })]);
    expect(calls).toBe(1);
  });
});

describe("criticize reads the public forecast (design 2026-09-09 §1.3)", () => {
  const weather = (o: Partial<Candidate> = {}): Candidate =>
    cand({ category: "weather", forecast_point: { lat: 40.78, lon: -73.97 }, topic_key: "nyc-high", ...o });

  it("shows the critic the forecast beside a weather candidate", async () => {
    const { db } = await makeTestDb();
    const seen: { user?: string } = {};
    await criticize(deps(db, { verdicts: [verdict(0)] }, seen), [weather()], { "0": "Thursday: 86F, Partly sunny" });
    expect(seen.user).toContain("PUBLIC FORECAST");
    expect(seen.user).toContain("86F");
  });
  it("rejects a weather candidate whose forecast could not be fetched, without calling the model", async () => {
    const { db } = await makeTestDb();
    let called = false;
    const d = deps(db, { verdicts: [] });
    d.claude = { structured: async () => { called = true; return { verdicts: [] }; } };
    const r = await criticize(d, [weather()], {});
    expect(called).toBe(false);
    expect(r.rejected[0]).toMatchObject({ reason: "uncontested" });
    expect(r.rejected[0]!.detail).toContain("forecast");
  });
  it("does not require a forecast for a non-weather candidate", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0)] }), [cand()], {});
    expect(r.passed).toHaveLength(1);
  });
  it("still rejects the lopsided read the forecast produces", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: 0.92 })] }), [weather()], { "0": "Thursday: 86F" });
    expect(r.rejected[0]!.reason).toBe("uncontested");
  });
});
