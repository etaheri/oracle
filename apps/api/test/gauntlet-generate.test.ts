import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { gatherAuthoringContext, generateCandidates } from "../src/pipeline/gauntlet/generate";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";

function deps(db: PipelineDeps["db"], claude: PipelineDeps["claude"]): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    telegram: { send: async () => {} },
    claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
    marketFetch: (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch,
    sourceFetch: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
  };
}

describe("gatherAuthoringContext / generateCandidates — split so a retry never re-fetches", () => {
  it("gathers context without calling the model", async () => {
    const { db } = await makeTestDb();
    let modelCalls = 0;
    const d = deps(db, { structured: async () => { modelCalls += 1; return { candidates: [] }; } });

    const ctx = await gatherAuthoringContext(d, "2026-09-08");
    expect(modelCalls).toBe(0);
    expect(ctx.recent).toBeTypeOf("string");
    expect(Array.isArray(ctx.signals)).toBe(true);
    expect(Array.isArray(ctx.recentTopicKeys)).toBe(true);
  });

  it("generateCandidates takes the context rather than fetching it", async () => {
    const { db } = await makeTestDb();
    let fetched = 0;
    const d = deps(db, { structured: async () => ({ candidates: [] }) });
    d.marketFetch = (async () => { fetched += 1; return new Response("[]"); }) as unknown as typeof fetch;

    const ctx = { recent: "none", signals: [], scorecard: "n/a", recentTopicKeys: [] };
    await generateCandidates(d, "2026-09-08", ctx);
    // The feeds belong to the context step. Fetching here would mean a retry
    // of the model call re-fetches them.
    expect(fetched).toBe(0);
  });
});
