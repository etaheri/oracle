import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { authorRound, rerollSlot, draftMessage } from "../src/pipeline/author";
import { upsertDraft } from "../src/pipeline/draft";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import * as schema from "../src/db/schema";

function fakeClaude(responses: unknown[]) {
  const calls: StructuredCall[] = [];
  const claude: ClaudeClient = {
    async structured(call) {
      calls.push(call);
      if (responses.length === 0) throw new Error("no more fake responses queued");
      return responses.shift();
    },
  };
  return { claude, calls };
}

function fakeDeps(db: PipelineDeps["db"], claude: ClaudeClient | null) {
  const sent: string[] = [];
  const deps: PipelineDeps = {
    db,
    claude,
    models: { author: "m-a", resolve: "m-r" },
    telegram: { send: async (t) => void sent.push(t) },
    now: () => new Date("2026-08-27T12:00:00Z"),
    // Feeds must never reach the network in tests; a rejecting fetch makes
    // every feed fail cleanly and authoring proceed market-blind.
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
  return { deps, sent };
}

const invalidDraft = { questions: [...validDraft.questions, { ...validDraft.questions[0]!, slot: 6 }] };

describe("authorRound", () => {
  it("throws when there is no claude client", async () => {
    const { db } = await makeTestDb();
    const { deps } = fakeDeps(db, null);
    await expect(authorRound(deps, "2026-08-27")).rejects.toThrow("pipeline: no claude client");
  });

  it("a) valid draft on first try: rows scheduled + telegram message has all texts and /reroll", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps, sent } = fakeDeps(db, claude);

    await authorRound(deps, "2026-08-27");

    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round!.status).toBe("scheduled");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5);

    expect(sent).toHaveLength(1);
    for (const q of validDraft.questions) {
      expect(sent[0]).toContain(q.text);
    }
    expect(sent[0]).toContain("/reroll");

    // The JSON Schema handed to Claude must genuinely mirror DraftQuestionSchema's
    // zod constraints, or a schema-valid-but-zod-invalid response (e.g. 3-char text)
    // needlessly burns the single retry.
    const itemSchema = (calls[0]!.schema as any).properties.questions.items;
    expect(itemSchema.properties.text.minLength).toBe(10);
    expect(itemSchema.properties.resolution_criteria.minLength).toBe(10);
    expect(itemSchema.properties.source_name.minLength).toBe(1);
    expect(itemSchema.properties.source_url.format).toBe("uri");
  });

  it("b) invalid then valid: retries exactly once, second prompt cites failed validation, rows scheduled", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([invalidDraft, validDraft]);
    const { deps, sent } = fakeDeps(db, claude);

    await authorRound(deps, "2026-08-27");

    expect(calls).toHaveLength(2);
    expect(calls[1]!.user).toContain("failed validation");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5);
    expect(sent).toHaveLength(1);
  });

  it("c) invalid twice: throws, no rows inserted", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([invalidDraft, invalidDraft]);
    const { deps, sent } = fakeDeps(db, claude);

    await expect(authorRound(deps, "2026-08-27")).rejects.toThrow();

    expect(calls).toHaveLength(2);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("includes the last 7 days of question texts as dedup context", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-08-21", status: "resolved" });
    await db.insert(schema.questions).values({
      roundDate: "2026-08-21",
      slot: 1,
      isBigOne: false,
      text: "Will the recent thing happen?",
      category: "news",
      resolutionCriteria: "c",
      sourceName: "s",
      opensAt: new Date("2026-08-21T16:00:00Z"),
      locksAt: new Date("2026-08-22T16:00:00Z"),
      resolveBy: new Date("2026-08-22T17:00:00Z"),
      status: "resolved",
    });
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);

    await authorRound(deps, "2026-08-27");

    expect(calls[0]!.system).toContain("Will the recent thing happen?");
  });
});

describe("rerollSlot", () => {
  it("throws when there is no scheduled draft for the date", async () => {
    const { db } = await makeTestDb();
    const { claude } = fakeClaude([]);
    const { deps } = fakeDeps(db, claude);
    await expect(rerollSlot(deps, "2026-08-27", 3, "more specific")).rejects.toThrow("no draft for 2026-08-27");
  });

  it("d) replaces only the targeted slot's question and re-sends the draft", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);

    const replacement = {
      slot: 3,
      category: "weather" as const,
      text: "Will it rain in NYC before midnight?",
      resolution_criteria: "NWS observed precipitation at Central Park station by 23:59 ET",
      source_name: "NWS",
      source_url: "https://weather.gov/nyc",
      author_probability: 0.45,
      is_big_one: false,
    };
    const { claude, calls } = fakeClaude([replacement]);
    const { deps, sent } = fakeDeps(db, claude);

    await rerollSlot(deps, "2026-08-27", 3, "make it about weather");

    expect(calls).toHaveLength(1);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.text).toBe(replacement.text);
    expect(slot3.resolutionCriteria).toBe(replacement.resolution_criteria);
    expect(slot3.sourceName).toBe(replacement.source_name);
    expect(slot3.sourceUrl).toBe(replacement.source_url);
    expect(slot3.category).toBe("weather");

    for (const other of validDraft.questions.filter((q) => q.slot !== 3)) {
      const row = qs.find((q) => q.slot === other.slot)!;
      expect(row.text).toBe(other.text);
    }

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(replacement.text);
    expect(sent[0]).not.toContain("%");
  });

  it("f) refuses to reroll a slot whose round has already published, and leaves the question unchanged", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    // Simulate publish: the round and its questions moved past "scheduled".
    await db.update(schema.rounds).set({ status: "open" }).where(eq(schema.rounds.date, "2026-08-27"));
    await db.update(schema.questions).set({ status: "open" }).where(eq(schema.questions.roundDate, "2026-08-27"));

    const { claude, calls } = fakeClaude([]);
    const { deps, sent } = fakeDeps(db, claude);

    await expect(rerollSlot(deps, "2026-08-27", 3, "guidance")).rejects.toThrow("draft already published");
    expect(calls).toHaveLength(0); // never even asked Claude
    expect(sent).toHaveLength(0);

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.text).toBe(validDraft.questions[2]!.text); // unchanged
    expect(slot3.status).toBe("open"); // unchanged
  });

  it("g) an early locks_at in the reroll response is kept on the slot's row and shown in the telegram summary", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);

    const replacement = {
      slot: 3,
      category: "sports" as const,
      text: "Will the home team win tonight's game?",
      resolution_criteria: "Official league boxscore final by 23:59 ET",
      source_name: "ESPN",
      source_url: "https://espn.com/game",
      author_probability: 0.5,
      is_big_one: false,
      locks_at: "2026-08-27T23:00:00Z",
    };
    const { claude } = fakeClaude([replacement]);
    const { deps, sent } = fakeDeps(db, claude);

    await rerollSlot(deps, "2026-08-27", 3, "make it about sports");

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.locksAt.toISOString()).toBe("2026-08-27T23:00:00.000Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("· locks 2026-08-27T23:00:00.000Z");
  });

  it("h) an out-of-range locks_at in the reroll response is clamped to noon D+1 and noted in the telegram message", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);

    const replacement = {
      slot: 3,
      category: "sports" as const,
      text: "Will the home team win tonight's game?",
      resolution_criteria: "Official league boxscore final by 23:59 ET",
      source_name: "ESPN",
      source_url: "https://espn.com/game",
      author_probability: 0.5,
      is_big_one: false,
      locks_at: "2026-08-29T00:00:00Z", // past noon D+1 — out of range
    };
    const { claude } = fakeClaude([replacement]);
    const { deps, sent } = fakeDeps(db, claude);

    await rerollSlot(deps, "2026-08-27", 3, "make it about sports");

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z"); // clamped to default
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("out of range");
  });

  it("e) rejects a reroll response that flips is_big_one", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);

    const flipped = {
      slot: 3,
      category: "weather" as const,
      text: "Will it rain in NYC before midnight?",
      resolution_criteria: "NWS observed precipitation at Central Park station by 23:59 ET",
      source_name: "NWS",
      source_url: "https://weather.gov/nyc",
      author_probability: 0.45,
      is_big_one: true, // slot 3 should never be the big one
    };
    const { claude } = fakeClaude([flipped]);
    const { deps, sent } = fakeDeps(db, claude);

    await expect(rerollSlot(deps, "2026-08-27", 3, "guidance")).rejects.toThrow();

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.text).toBe(validDraft.questions[2]!.text); // unchanged
    expect(sent).toHaveLength(0);
  });
});

describe("draftMessage", () => {
  it("formats slot, category, star on the big one, percentage when present, and the reroll hint", () => {
    const msg = draftMessage("2026-08-28", [
      { slot: 1, category: "markets", text: "Will the S&P 500 close green on Friday?", resolution_criteria: "Official close per CNBC markets page", is_big_one: false, author_probability: 0.55 },
      { slot: 5, category: "news", text: "Will X happen?", resolution_criteria: "Y by Z", is_big_one: true, author_probability: 0.4 },
    ]);
    expect(msg).toContain("HERMES · DRAFT 2026-08-28");
    expect(msg).toContain("1 [markets] Will the S&P 500 close green on Friday? (55%)");
    expect(msg).toContain("↳ Official close per CNBC markets page");
    expect(msg).toContain("5 [news] ★ Will X happen? (40%)");
    expect(msg).toContain("publishes at noon · /reroll <slot> [guidance] · /status");
  });

  it("omits percentages when author_probability is absent", () => {
    const msg = draftMessage("2026-08-28", [
      { slot: 1, category: "markets", text: "Will X?", resolution_criteria: "Y", is_big_one: false },
    ]);
    expect(msg).not.toContain("%");
    expect(msg).toContain("1 [markets] Will X?");
  });
});

describe("market-informed authoring", () => {
  const signalFetch = ((async (url: any) => {
    const u = String(url);
    if (u.includes("manifold.markets")) {
      return new Response(JSON.stringify([
        { question: "Will the Fed cut rates tomorrow?", probability: 0.42, closeTime: new Date("2026-08-28T10:00:00Z").getTime(), volume: 5400, uniqueBettorCount: 40, outcomeType: "BINARY", url: "https://manifold.markets/x/fed" },
      ]), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  }) as unknown) as typeof fetch;

  it("feeds market signals into the authoring prompt with the never-resolve-by-market rule", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);
    deps.marketFetch = signalFetch;

    await authorRound(deps, "2026-08-27");

    expect(calls[0]!.system).toContain("LIVE MARKET SIGNALS");
    expect(calls[0]!.system).toContain("Will the Fed cut rates tomorrow?");
    expect(calls[0]!.system).toContain("42% YES");
    expect(calls[0]!.system).toContain("NEVER cite a prediction market as the resolution source");
  });

  it("stamps market_prob through to the questions table", async () => {
    const { db } = await makeTestDb();
    const withMarket = { questions: validDraft.questions.map((q) => (q.slot === 5 ? { ...q, market_prob: 0.42 } : { ...q, market_prob: null })) };
    const { claude } = fakeClaude([withMarket]);
    const { deps } = fakeDeps(db, claude);
    deps.marketFetch = signalFetch;

    await authorRound(deps, "2026-08-27");

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const big = qs.find((q) => q.slot === 5)!;
    expect(Number(big.marketProb)).toBeCloseTo(0.42);
    expect(qs.find((q) => q.slot === 1)!.marketProb).toBeNull();
  });

  it("authoring proceeds market-blind when every feed fails (no signals block)", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude); // default marketFetch rejects

    await authorRound(deps, "2026-08-27");

    expect(calls[0]!.system).not.toContain("LIVE MARKET SIGNALS");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5);
  });
});
