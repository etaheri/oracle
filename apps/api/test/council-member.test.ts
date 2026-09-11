import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { BudgetExhausted } from "../src/pipeline/spend";
import { commitMember } from "../src/pipeline/council/member";
import { lessonsFor, seriesKeyOf, LESSON_CAPS } from "../src/pipeline/council/lessonsFor";
import { memberModel, COUNCIL_PROMPT_VERSION } from "../src/pipeline/council/members";

const DATE = "2026-09-10";
const NOW = new Date("2026-09-10T14:00:00Z");
type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

function makeDeps(db: TestDb, claude: { structured: ClaudeClient["structured"] } | null): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    councilModels: { sonnet: "m-sonnet", opus: "m-opus", haiku: "m-haiku" },
    telegram: { send: async () => {} }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
}

async function world() {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "scheduled", marketProb: "0.40", marketSeriesKey: "KXHIGHNY" }).where(eq(schema.questions.roundDate, DATE));
  for (const r of rows.slice(0, 4)) {
    await db.insert(schema.evidence).values([1, 2, 3].map((rank) => ({ questionId: r.id, rank, url: `https://e/${rank}`, title: `Item ${rank}`, source: "e", publishedAt: new Date("2026-09-09T00:00:00Z"), highlight: `Highlight ${rank}.`, retrievedAt: NOW })));
  }
  return { db, rows };
}

const fiveLines = (p = 0.4) => ({ lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: p, reasoning: `Because ${slot}.`, cited: slot === 1 ? [1, 3, 9] : [] })) });

describe("commitMember (spec §6)", () => {
  it("asks the member's model once, with no web search, the pack per question and the tool schema", async () => {
    const { db } = await world();
    const calls: StructuredCall[] = [];
    const r = await commitMember(makeDeps(db, { structured: async (c) => { calls.push(c); return fiveLines(); } }), DATE, "sonnet");
    expect(calls.length).toBe(1);
    const c = calls[0]!;
    expect(c.model).toBe("m-sonnet");
    expect(c.webSearch).toBeUndefined();
    expect(c.schemaName).toBe("council_lines");
    expect(c.system).toContain(DATE);
    expect(c.system).toContain(NOW.toISOString());
    expect(c.user).toContain("[1] Item 1 — e, 2026-09-09: Highlight 1.");
    expect(c.user).toContain("THE MARKET'S PRICE: 40% YES");
    expect(c.user).toContain("No evidence was retrieved for this question.");
    expect(r.member).toBe("sonnet");
    expect(r.lines.length).toBe(5);
    expect(r.abstained).toEqual([]);
    // Out-of-pack rank 9 is dropped, not fatal (C8).
    expect(r.lines[0]!.cited).toEqual([1, 3]);
    expect(r.lines[4]!.cited).toEqual([]);
  });

  it("abstains on every slot when the call throws, and returns the error as a value", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, { structured: async () => { throw new Error("timeout"); } }), DATE, "opus");
    expect(r.lines).toEqual([]);
    expect(r.abstained).toEqual([1, 2, 3, 4, 5]);
    expect(r.error).toBe("timeout");
  });

  it("abstains on a slot whose probability is out of range and on a missing slot", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, { structured: async () => ({ lines: [{ slot: 1, p_yes: 0.99, reasoning: "x", cited: [] }, { slot: 2, p_yes: 0.5, reasoning: "y", cited: [] }] }) }), DATE, "haiku");
    expect(r.lines.map((l) => l.slot)).toEqual([2]);
    expect(r.abstained).toEqual([1, 3, 4, 5]);
  });

  it("abstains entirely on output that is not the schema", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, { structured: async () => ({ nonsense: true }) }), DATE, "haiku");
    expect(r.abstained).toEqual([1, 2, 3, 4, 5]);
    expect(r.error).toMatch(/schema/);
  });

  it("lets BudgetExhausted through", async () => {
    const { db } = await world();
    await expect(commitMember(makeDeps(db, { structured: async () => { throw new BudgetExhausted(DATE, 1, true); } }), DATE, "sonnet")).rejects.toBeInstanceOf(BudgetExhausted);
  });

  it("without a client, abstains", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, null), DATE, "sonnet");
    expect(r.abstained.length).toBe(5);
  });

  it("feeds back only the member's own lessons known before the commit instant, and records their ids", async () => {
    const { db, rows } = await world();
    const settled = (d: string) => new Date(d);
    await db.insert(schema.lessons).values([
      { member: "sonnet", seriesKey: "KXHIGHNY", questionId: rows[0]!.id, text: "Same series, known.", resolvedAt: settled("2026-09-09T20:00:00Z") },
      { member: "sonnet", seriesKey: "KXHIGHNY", questionId: rows[1]!.id, text: "Same series, from the future.", resolvedAt: settled("2026-09-10T15:00:00Z") },
      { member: "sonnet", seriesKey: "sports", questionId: rows[2]!.id, text: "Other series, known.", resolvedAt: settled("2026-09-08T20:00:00Z") },
      { member: "opus", seriesKey: "KXHIGHNY", questionId: rows[3]!.id, text: "Opus's lesson.", resolvedAt: settled("2026-09-09T20:00:00Z") },
    ]);
    const calls: StructuredCall[] = [];
    const r = await commitMember(makeDeps(db, { structured: async (c) => { calls.push(c); return fiveLines(); } }), DATE, "sonnet");
    const user = calls[0]!.user;
    expect(user).toContain("Same series, known.");
    expect(user).toContain("Other series, known.");
    expect(user).not.toContain("from the future");
    expect(user).not.toContain("Opus's lesson");
    expect(r.lines[0]!.lessonsReceived.length).toBe(2);
  });
});

describe("lessonsFor caps", () => {
  it("takes at most five from the series and three from elsewhere, newest first", async () => {
    // The unique (member, question) index means one lesson per question per
    // member, so the pool of questions has to be as wide as the lessons.
    const { db, rows } = await world();
    const more = await seedRound(db, { date: "2026-08-01", opensAt: new Date("2026-08-01T16:00:00Z"), locksAt: new Date("2026-08-02T16:00:00Z") });
    const others = await seedRound(db, { date: "2026-07-01", opensAt: new Date("2026-07-01T16:00:00Z"), locksAt: new Date("2026-07-02T16:00:00Z") });
    const sameSeries = [...rows, ...more].slice(0, 8).map((q, i) => ({ member: "haiku", seriesKey: "KXHIGHNY", questionId: q.id, text: `S${i}`, resolvedAt: new Date(Date.UTC(2026, 8, 1 + i)) }));
    const otherSeries = others.map((q, i) => ({ member: "haiku", seriesKey: "other", questionId: q.id, text: `O${i}`, resolvedAt: new Date(Date.UTC(2026, 7, 1 + i)) }));
    await db.insert(schema.lessons).values([...sameSeries, ...otherSeries]);
    const got = await lessonsFor(db, "haiku", "KXHIGHNY", NOW);
    expect(got.length).toBe(LESSON_CAPS.SAME_SERIES + LESSON_CAPS.OTHER);
    expect(got.slice(0, 5).map((l) => l.text)).toEqual(["S7", "S6", "S5", "S4", "S3"]);
    expect(got.slice(5).map((l) => l.text)).toEqual(["O4", "O3", "O2"]);
  });
  it("falls back to the category as the series key", () => {
    expect(seriesKeyOf({ marketSeriesKey: null, category: "weather" })).toBe("weather");
    expect(seriesKeyOf({ marketSeriesKey: "KXHIGHNY", category: "weather" })).toBe("KXHIGHNY");
  });
});

describe("members", () => {
  it("resolve their model from deps with defaults", () => {
    // No database is touched here; the deps only carry the model table.
    const deps = makeDeps(null as unknown as TestDb, null);
    expect(memberModel(deps, "opus")).toBe("m-opus");
    expect(memberModel({ ...deps, councilModels: undefined }, "haiku")).toBe("claude-haiku-4-5-20251001");
    expect(COUNCIL_PROMPT_VERSION).toBe("council-v1");
  });
});
