import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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

const replacement = (resolvesAt: string) => ({
  slot: 1,
  category: "markets" as const,
  text: "Will the replacement thing happen before the close?",
  resolution_criteria: "Per the source page, at the stated deadline",
  source_name: "SRC",
  source_url: "https://example.com/y",
  author_probability: 0.5,
  is_big_one: false,
  market_prob: null,
  resolves_at: resolvesAt,
});

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
      resolves_at: "2026-08-27T21:00:00Z",
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

  it("g) an early resolves_at in the reroll response is kept on the slot's row and shown in the telegram summary", async () => {
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
      resolves_at: "2026-08-27T23:00:00Z",
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

  it("a resolves_at later than noon D+1 clamps down to the default lock (the min() rule)", async () => {
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
      resolves_at: "2026-08-29T00:00:00Z", // past noon D+1
    };
    const { claude } = fakeClaude([replacement]);
    const { deps, sent } = fakeDeps(db, claude);

    await rerollSlot(deps, "2026-08-27", 3, "make it about sports");

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z"); // clamped to default
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain("out of range");
    expect(sent[0]).toContain("locks at noon");
  });

  it("reroll derives the slot's lock from resolves_at", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const { claude } = fakeClaude([replacement("2026-08-27T22:00:00Z")]);
    const { deps } = fakeDeps(db, claude);

    await rerollSlot(deps, "2026-08-27", 1, "make it sharper");

    const q = await db.query.questions.findFirst({
      where: and(eq(schema.questions.roundDate, "2026-08-27"), eq(schema.questions.slot, 1)),
    });
    expect(q!.locksAt.toISOString()).toBe("2026-08-27T22:00:00.000Z");
  });

  it("reroll refuses a resolves_at already past at open instead of silently defaulting", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const { claude } = fakeClaude([replacement("2026-08-27T15:00:00Z")]);
    const { deps } = fakeDeps(db, claude);

    await expect(rerollSlot(deps, "2026-08-27", 1, "guidance")).rejects.toThrow("resolves_at out of range");

    // And the live draft is untouched — a refused reroll must never half-write.
    const q = await db.query.questions.findFirst({
      where: and(eq(schema.questions.roundDate, "2026-08-27"), eq(schema.questions.slot, 1)),
    });
    expect(q!.text).toBe(validDraft.questions[0]!.text);
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
      resolves_at: "2026-08-27T21:00:00Z",
    };
    const { claude } = fakeClaude([flipped]);
    const { deps, sent } = fakeDeps(db, claude);

    await expect(rerollSlot(deps, "2026-08-27", 3, "guidance")).rejects.toThrow("reroll: is_big_one mismatch for slot 3");

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

  it("tells the model that market-adapted questions lock at the market's close", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);
    // One live signal, injected through marketFetch rather than the network.
    // closeTime must sit inside feeds.ts's 36h horizon measured from
    // `deps.now()` (fakeDeps pins it to 2026-08-27T12:00:00Z), NOT from the
    // real clock — a wall-clock closeTime is filtered out and the block stays
    // empty, which is a silently passing-for-the-wrong-reason test.
    const feedNow = new Date("2026-08-27T12:00:00Z").getTime();
    deps.marketFetch = (async (url: string) =>
      new Response(
        String(url).includes("manifold")
          ? JSON.stringify([{ question: "Will X?", probability: 0.5, closeTime: feedNow + 3_600_000, volume: 900, uniqueBettorCount: 9, outcomeType: "BINARY", url: "https://manifold.markets/x" }])
          : "[]",
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    await authorRound(deps, "2026-08-27");

    expect(calls[0]!.system.toLowerCase()).toContain("market's own close");
  });
});

describe("the authoring contract", () => {
  async function systemPromptFor(date: string): Promise<string> {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);
    await authorRound(deps, date);
    return calls[0]!.system;
  }

  it("no longer demands an answer that exists before the lock", async () => {
    const system = await systemPromptFor("2026-08-27");
    expect(system).not.toContain("11:00 AM ET");
    expect(system).toContain("resolves_at");
    expect(system).toContain("after-lock");
    expect(system).toContain("noon ET on 2026-08-28");
  });

  it("gives weather a measurement window that starts after the round opens", async () => {
    const system = await systemPromptFor("2026-08-27");
    expect(system.toLowerCase()).toContain("measurement period must begin after the round opens");
  });

  it("tells the model weather's resolves_at must land before the round's own close, matching upsertDraft's hard enforcement", async () => {
    const system = await systemPromptFor("2026-08-27");
    expect(system.toLowerCase()).toContain("must fall before noon et on 2026-08-28");
  });

  it("prefers resolves_at comfortably before noon so the named source has actually published by the 12:10 read", async () => {
    const system = await systemPromptFor("2026-08-27");
    expect(system).toContain("comfortably before noon ET on 2026-08-28");
    expect(system).toContain("12:10 ET on 2026-08-28");
  });

  it("the reroll prompt's resolution_criteria bullet no longer names a separate deadline than resolves_at", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const { claude, calls } = fakeClaude([replacement("2026-08-27T22:00:00Z")]);
    const { deps } = fakeDeps(db, claude);

    await rerollSlot(deps, "2026-08-27", 1, "make it sharper");

    expect(calls[0]!.system).not.toContain("and the deadline");
    expect(calls[0]!.system).toContain("resolution_criteria must name the exact measurement and the exact source page");
  });

  it("the reroll prompt also requires weather's resolves_at to fall before the round's own close", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const { claude, calls } = fakeClaude([replacement("2026-08-27T22:00:00Z")]);
    const { deps } = fakeDeps(db, claude);

    await rerollSlot(deps, "2026-08-27", 1, "make it sharper");

    expect(calls[0]!.system.toLowerCase()).toContain("must fall before noon et on 2026-08-28");
  });
});
