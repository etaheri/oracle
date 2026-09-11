import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";
import { retrieveEvidence, resolutionDomains, EVIDENCE } from "../src/pipeline/council/evidence";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "fixtures/exa/search.json"), "utf8");
const DATE = "2026-09-10";
const NOW = new Date("2026-09-10T14:00:00Z");

type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];
function makeDeps(db: TestDb, exaFetch: typeof fetch, exaApiKey: string | undefined = "test-key"): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude: null,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    telegram: { send: async () => {} }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
    exaApiKey, exaFetch,
  };
}

async function scheduledV3(db: TestDb) {
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "scheduled", resolutionCriteria: "NYC high temp on Sep 11\n\nResolves per https://www.weather.gov/okx/ climate data.", sourceUrl: "https://kalshi.com/markets/kxhighny" }).where(eq(schema.questions.roundDate, DATE));
  return rows;
}

describe("retrieveEvidence (spec §5)", () => {
  it("asks Exa once per question with the window, the highlights and the resolution domain, and stores the pack in rank order", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    const bodies: Array<Record<string, unknown>> = [];
    const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.exa.ai/search");
      expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
      bodies.push(JSON.parse(String(init!.body)));
      return new Response(FIXTURE, { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const r = await retrieveEvidence(makeDeps(db, stub), DATE);
    expect(bodies.length).toBe(5);
    expect(bodies[0]).toMatchObject({ numResults: EVIDENCE.RESULTS, endPublishedDate: NOW.toISOString(), startPublishedDate: new Date(NOW.getTime() - EVIDENCE.WINDOW_DAYS * 86_400_000).toISOString(), includeDomains: ["weather.gov"], contents: { highlights: { numSentences: EVIDENCE.HIGHLIGHT_SENTENCES, highlightsPerUrl: 1 } } });
    expect(String(bodies[0]!.query)).toContain("NYC high temp");
    expect(r.packs.every((p) => p.count === 3 && !p.skipped)).toBe(true);
    expect(r.cost).toBeCloseTo(5 * 0.0105, 6);
    const items = await db.query.evidence.findMany({ where: eq(schema.evidence.questionId, r.packs[0]!.questionId), orderBy: (e, { asc }) => [asc(e.rank)] });
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(items[0]!.source).toBe("weather.gov");
    expect(items[0]!.publishedAt!.toISOString()).toBe("2026-09-09T18:00:00.000Z");
    expect(items[2]!.highlight).toBe("No highlight here");
    expect(items[2]!.publishedAt).toBeNull();
    expect(items[0]!.retrievedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("skips a question that already has a pack", async () => {
    const { db } = await makeTestDb();
    const rows = await scheduledV3(db);
    await db.insert(schema.evidence).values({ questionId: rows[0]!.id, rank: 1, url: "https://x", title: "X", source: "x", highlight: "h", retrievedAt: NOW });
    let calls = 0;
    const stub = (async () => { calls++; return new Response(FIXTURE, { status: 200 }); }) as typeof fetch;
    const r = await retrieveEvidence(makeDeps(db, stub), DATE);
    expect(calls).toBe(4);
    expect(r.packs.find((p) => p.questionId === rows[0]!.id)).toMatchObject({ skipped: true, count: 1 });
  });

  it("a failed search leaves an empty pack and never throws", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    const stub = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const r = await retrieveEvidence(makeDeps(db, stub), DATE);
    expect(r.packs.every((p) => p.count === 0 && p.error)).toBe(true);
    expect((await db.query.evidence.findMany()).length).toBe(0);
  });

  it("without an API key it retrieves nothing and says so", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    const stub = (async () => { throw new Error("must not be called"); }) as typeof fetch;
    // Not makeDeps(db, stub, undefined): a default parameter substitutes for
    // an EXPLICIT undefined argument too, so that call would silently hand
    // back exaApiKey: "test-key" and never test the no-key path. Overriding
    // the built object's property is the only way to leave it truly absent.
    const r = await retrieveEvidence({ ...makeDeps(db, stub), exaApiKey: undefined }, DATE);
    expect(r.packs.every((p) => p.error === "no EXA_API_KEY")).toBe(true);
  });

  it("does nothing on a version 2 round", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, DATE));
    const stub = (async () => { throw new Error("must not be called"); }) as typeof fetch;
    expect((await retrieveEvidence(makeDeps(db, stub), DATE)).packs).toEqual([]);
  });
});

describe("resolutionDomains", () => {
  it("takes hosts named in the rules and drops the exchange's own", () => {
    expect(resolutionDomains("Resolves per https://www.weather.gov/okx/ and https://kalshi.com/x", "https://kalshi.com/markets/kxhighny")).toEqual(["weather.gov"]);
  });
  it("is undefined when the rules name no source", () => {
    expect(resolutionDomains("Resolves YES if the Yankees win.", "https://polymarket.com/event/x")).toBeUndefined();
  });
});
