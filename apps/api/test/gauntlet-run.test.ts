import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { runAuthoringGauntlet } from "../src/pipeline/gauntlet";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";

// One fake Claude that answers each schemaName in turn. Every tier's contract
// is exercised through the real orchestration; nothing is stubbed past it.
function fakeClaude(over: Partial<Record<string, unknown>> = {}) {
  const candidates = [1, 2, 3, 4, 5, 6].map((n) => ({
    category: (["markets", "sports", "weather", "culture", "news", "markets"] as const)[n - 1],
    text: `Will thing ${n} happen?`,
    resolution_criteria: "The official number on the source's own page",
    source_name: "SRC",
    source_url: `https://example.com/${n}`,
    author_probability: 0.5,
    market_prob: null,
    resolves_at: "2026-09-06T14:00:00Z",
    topic_key: `topic-${n}`,
  }));
  const defaults: Record<string, unknown> = {
    candidate_round: { candidates },
    critic_verdicts: { verdicts: candidates.map((_, i) => ({ index: i, readable_two_ways: false, criteria_determine_outcome: true, resolves_at_plausible: true, critic_probability: 0.5 + i * 0.01, reasons: [] })) },
    resolution: { outcome: "unverifiable", quotes: [], reasoning: "not yet" },
    taste_verdicts: { verdicts: candidates.map((_, i) => ({ index: i, allowed: true, reason: "" })) },
  };
  const table = { ...defaults, ...over };
  return {
    structured: async (call: { schemaName: string }) => {
      const r = table[call.schemaName];
      if (r === undefined) throw new Error(`unexpected schemaName ${call.schemaName}`);
      if (typeof r === "function") return (r as () => unknown)();
      return r;
    },
  };
}

function deps(db: PipelineDeps["db"], claude: PipelineDeps["claude"], sent: string[] = []): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    telegram: { send: async (t) => void sent.push(t) },
    claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
    marketFetch: (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch,
    sourceFetch: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
  };
}

describe("runAuthoringGauntlet", () => {
  it("publishes a scheduled round and records what it cost", async () => {
    const { db } = await makeTestDb();
    const sent: string[] = [];
    const r = await runAuthoringGauntlet(deps(db, fakeClaude(), sent), "2026-09-05");
    expect(r.published).toBe(true);
    expect(r.written).toBe(6);
    expect(r.rejected).toBe(0);

    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round!.status).toBe("scheduled");
    expect(round!.candidatesWritten).toBe(6);
    expect(round!.candidatesRejected).toBe(0);

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-09-05") });
    expect(qs).toHaveLength(5);
    expect(qs.every((q) => q.topicKey !== null)).toBe(true);
    expect(sent.join("\n")).toContain("6 candidates");
  });

  it("counts a dead source as a rejection and still ships the round", async () => {
    const { db } = await makeTestDb();
    const d = deps(db, fakeClaude());
    d.sourceFetch = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/6") ? new Response("", { status: 404 }) : new Response("", { status: 200 })
    ) as unknown as typeof fetch;
    const r = await runAuthoringGauntlet(d, "2026-09-05");
    expect(r.published).toBe(true);
    expect(r.rejected).toBe(1);
    expect(r.tally["dead-source"]).toBe(1);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round!.candidatesRejected).toBe(1);
  });

  it("REJECTS a candidate the pre-flight can already answer", async () => {
    const { db } = await makeTestDb();
    // Every pre-flight now answers YES with receipts: nothing survives.
    const r = await runAuthoringGauntlet(
      deps(db, fakeClaude({ resolution: { outcome: "yes", quotes: [{ url: "https://example.com/1", quote: "it happened" }], reasoning: "done" } })),
      "2026-09-05",
    );
    expect(r.published).toBe(false);
    expect(r.tally["already-resolvable"]).toBe(6);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round).toBeUndefined();
  });

  it("refuses the whole night when the taste gate fails, leaving noon to the bank", async () => {
    const { db } = await makeTestDb();
    const r = await runAuthoringGauntlet(
      deps(db, fakeClaude({ taste_verdicts: () => { throw new Error("taste is down"); } })),
      "2026-09-05",
    );
    expect(r.published).toBe(false);
    expect(r.tally.taste).toBe(6);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round).toBeUndefined();
  });

  it("never publishes a candidate that failed a gate, even when the round would otherwise be short", async () => {
    const { db } = await makeTestDb();
    // Five ambiguous, one sound: four survivors is not a round, and the one
    // sound candidate must not be joined by any of the five.
    const d = deps(db, fakeClaude({
      critic_verdicts: { verdicts: [0, 1, 2, 3, 4, 5].map((i) => ({ index: i, readable_two_ways: i > 0, criteria_determine_outcome: true, resolves_at_plausible: true, critic_probability: 0.5, reasons: [] })) },
    }));
    const r = await runAuthoringGauntlet(d, "2026-09-05");
    expect(r.published).toBe(false);
    expect(r.tally.ambiguous).toBe(5);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-09-05") });
    expect(qs).toHaveLength(0);
  });

  it("survives a cold start: no history, no market signals, an empty database", async () => {
    const { db } = await makeTestDb();
    const d = deps(db, fakeClaude());
    d.marketFetch = (async () => { throw new Error("feeds are down"); }) as unknown as typeof fetch;
    const r = await runAuthoringGauntlet(d, "2026-09-05");
    expect(r.published).toBe(true);
  });

  it("narrates what it threw away, by reason", async () => {
    const { db } = await makeTestDb();
    const sent: string[] = [];
    const d = deps(db, fakeClaude(), sent);
    d.sourceFetch = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/6") ? new Response("", { status: 404 }) : new Response("", { status: 200 })
    ) as unknown as typeof fetch;
    await runAuthoringGauntlet(d, "2026-09-05");
    const msg = sent.join("\n");
    expect(msg).toContain("rejected:");
    expect(msg).toContain("dead-source");
  });
});
