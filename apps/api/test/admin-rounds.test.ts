import { describe, expect, it, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { upsertDraft, CROWD_RESOLUTION_CRITERIA, RESOLVES_AFTER_LOCK } from "../src/pipeline/draft";
import type { PipelineDeps } from "../src/pipeline";
import * as schema from "../src/db/schema";
import { inlineStarter } from "../src/pipeline/workflows";
import type { ExchangeFeed, MarketCandidate } from "../src/pipeline/exchanges/types";
import { noonET, addDays } from "../src/pipeline/clock";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

afterEach(() => vi.useRealTimers());

function admin(app: ReturnType<typeof createApp>) {
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), "x-admin-secret": "admin", "content-type": "application/json" } });
}

function fakePipeline(db: PipelineDeps["db"], nowIso: string): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db, claude: null, models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    telegram: { send: async () => {} },
    now: () => new Date(nowIso),
  };
}

// Helper to create a feed of five markets with distinct categories
function fiveMarkets(roundDate: string): ExchangeFeed {
  const closesAt = new Date(noonET(addDays(roundDate, 1)).getTime() + 10 * 3_600_000).toISOString();
  const rows: MarketCandidate[] = (["sports", "markets", "weather", "culture", "news"] as const).map((category, i) => ({
    source: "kalshi", marketId: `m${i}`, eventKey: `E-${i}`, seriesKey: "KXT",
    title: `Will market ${i} settle yes?`, rules: "Resolves per the exchange rules for this market.",
    url: "https://kalshi.com/markets/kxt", category, prob: 0.4, volume: 50_000 - i * 1_000, closesAt,
  }));
  return { source: "kalshi", list: async () => rows, read: async () => ({ settled: false, outcome: null, raw: null }) };
}

// A canned Claude: the voice call echoes titles as questions; the taste call allows everything unless told otherwise
function claudeWith(opts: { refuse?: string[]; calls: string[] }): NonNullable<PipelineDeps["claude"]> {
  return {
    async structured(call) {
      opts.calls.push(call.schemaName);
      if (call.schemaName === "oracle_voice") {
        const slots = [...call.user.matchAll(/\[slot (\d)[^\]]*\]\nTITLE: (.+)/g)];
        return { questions: slots.map((m) => ({ slot: Number(m[1]), text: m[2]!.trim() + "?", context: "Some background." })) };
      }
      if (call.schemaName === "taste_verdicts") {
        const lines = call.user.split("\n").filter((l) => /^\[\d+\]/.test(l));
        return { verdicts: lines.map((l, i) => ({ index: i, allowed: !(opts.refuse ?? []).some((r) => l.includes(r)), reason: "" })) };
      }
      throw new Error(`unexpected call ${call.schemaName}`);
    },
  };
}

describe("POST /admin/rounds/:date", () => {
  it("rejects an invalid draft", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-08-27", { method: "POST", body: JSON.stringify({ questions: [] }) });
    expect(res.status).toBe(400);
  });

  it("rejects when the round exists and is not scheduled", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await seedRound(db, { date: "2026-08-27", opensAt: new Date("2026-08-27T16:00:00Z"), locksAt: new Date("2026-08-28T16:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-08-27", { method: "POST", body: JSON.stringify(validDraft) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "round not editable" });
  });

  it("accepts a valid draft", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-08-27", { method: "POST", body: JSON.stringify(validDraft) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round!.status).toBe("scheduled");
  });

  it("requires the admin secret", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await app.request("/admin/rounds/2026-08-27", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validDraft) });
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/rounds/:date", () => {
  it("404s on an unknown round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-08-27");
    expect(res.status).toBe(404);
  });

  it("returns round + questions", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await upsertDraft(db, "2026-08-27", validDraft);
    const res = await admin(app)("/admin/rounds/2026-08-27");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: { date: string; status: string }; questions: Array<{ slot: number; status: string; text: string; category: string; outcome: string | null }> };
    expect(body.round).toEqual({ date: "2026-08-27", status: "scheduled" });
    expect(body.questions).toHaveLength(5);
    expect(body.questions[0]).toMatchObject({ slot: 1, status: "scheduled", category: "markets", outcome: null });
  });
});

describe("POST /admin/rounds/:date/publish", () => {
  it("404s on an unknown round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-08-27/publish", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("409s when the round is not scheduled", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await seedRound(db, { date: "2026-08-27", opensAt: new Date("2026-08-27T16:00:00Z"), locksAt: new Date("2026-08-28T16:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-08-27/publish", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not publishable" });
  });

  it("409s when another round is already open", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    await upsertDraft(db, "2026-08-27", validDraft);
    const res = await admin(app)("/admin/rounds/2026-08-27/publish", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not publishable" });
  });

  it("publishes a scheduled draft", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await upsertDraft(db, "2026-08-27", validDraft);
    const res = await admin(app)("/admin/rounds/2026-08-27/publish", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-27") });
    expect(round!.status).toBe("open");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs.every((q) => q.status === "open")).toBe(true);
  });
});

describe("PATCH /admin/questions/:id", () => {
  it("409s for a committed scheduled question and preserves the draft", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await upsertDraft(db, "2026-08-27", validDraft);
    const q = (await db.query.questions.findFirst({ where: eq(schema.questions.roundDate, "2026-08-27") }))!;
    await db.update(schema.rounds).set({ oracleCommittedAt: new Date() }).where(eq(schema.rounds.date, "2026-08-27"));
    const res = await admin(app)(`/admin/questions/${q.id}`, { method: "PATCH", body: JSON.stringify({ text: "Will the edited thing happen tomorrow?" }) });
    expect(res.status).toBe(409);
    const reroll = await admin(app)("/admin/rounds/2026-08-27", { method: "POST", body: JSON.stringify(validDraft) });
    expect(reroll.status).toBe(409);
    expect((await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) }))!.text).toBe(q.text);
  });
  it("edits a scheduled question", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await upsertDraft(db, "2026-08-27", validDraft);
    const q = (await db.query.questions.findFirst({ where: eq(schema.questions.roundDate, "2026-08-27") }))!;
    const res = await admin(app)(`/admin/questions/${q.id}`, { method: "PATCH", body: JSON.stringify({ text: "Will the edited thing happen tomorrow?" }) });
    expect(res.status).toBe(200);
    const updated = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    expect(updated!.text).toBe("Will the edited thing happen tomorrow?");
  });

  it("400s on invalid body", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await upsertDraft(db, "2026-08-27", validDraft);
    const q = (await db.query.questions.findFirst({ where: eq(schema.questions.roundDate, "2026-08-27") }))!;
    const res = await admin(app)(`/admin/questions/${q.id}`, { method: "PATCH", body: JSON.stringify({ text: "short" }) });
    expect(res.status).toBe(400);
  });

  it("409s when the question is not scheduled", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-27", opensAt: new Date("2026-08-27T16:00:00Z"), locksAt: new Date("2026-08-28T16:00:00Z") });
    const res = await admin(app)(`/admin/questions/${qs[0]!.id}`, { method: "PATCH", body: JSON.stringify({ text: "Will the edited thing happen tomorrow?" }) });
    expect(res.status).toBe(409);
  });
});

describe("POST /admin/pipeline/tick", () => {
  it("503s when the pipeline isn't configured", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/pipeline/tick", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pipeline not configured" });
  });

  it("executes a tick with the configured pipeline", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const pipeline = fakePipeline(db, "2026-08-27T16:01:00Z");
    const app = createApp({ db, env, pipeline });
    const res = await admin(app)("/admin/pipeline/tick", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; executed: string[] };
    expect(body.ok).toBe(true);
    expect(body.executed).toContain("lock:2026-08-26");
  });
});

describe("POST /admin/questions/:id/resolve", () => {
  it("resolve refuses a judged question without force, re-judges with it, and rescores a settled round", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-27T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-27", opensAt: new Date("2026-08-27T16:00:00Z"), locksAt: new Date("2026-08-28T16:00:00Z") });
    const admin = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-admin-secret": "admin" }, body: JSON.stringify(body) });
    expect((await admin(`/admin/questions/${qs[0]!.id}/resolve`, { outcome: "yes" })).status).toBe(200);
    expect((await admin(`/admin/questions/${qs[0]!.id}/resolve`, { outcome: "no" })).status).toBe(409);
    const forced = await admin(`/admin/questions/${qs[0]!.id}/resolve`, { outcome: "no", force: true });
    expect(forced.status).toBe(200);
    expect(await forced.json()).toEqual({ ok: true, rescored: 0 }); // round not settled yet
  });

  it("says so when a re-resolution leaves paid stakes unrevised", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-27T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-27", opensAt: new Date("2026-08-27T16:00:00Z"), locksAt: new Date("2026-08-28T16:00:00Z") });
    await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, "2026-08-27"));
    await db.update(schema.questions).set({ linePYes: "0.35" }).where(eq(schema.questions.id, qs[0]!.id));
    const [player] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({
      questionId: qs[0]!.id, userId: player!.id, answer: true, confidence: 70,
      fortuneAtSeal: 1000, stake: 40, linePYes: "0.35",
    });
    const post = (body: unknown) => app.request(`/admin/questions/${qs[0]!.id}/resolve`, { method: "POST", headers: { "content-type": "application/json", "x-admin-secret": "admin" }, body: JSON.stringify(body) });

    expect((await post({ outcome: "yes" })).status).toBe(200);
    const paid = await db.query.users.findFirst({ where: eq(schema.users.id, player!.id) });
    expect(paid!.fortune).toBe(1074);

    const forced = await post({ outcome: "no", force: true });
    expect(forced.status).toBe(200);
    const body = (await forced.json()) as { ok: boolean; fortune_revised?: boolean; note?: string };
    expect(body.ok).toBe(true);
    expect(body.fortune_revised).toBe(false);
    expect(body.note).toMatch(/1 stake was already paid/);
    // And the flip really did not move the money.
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, player!.id) }))!.fortune).toBe(1074);
  });
});

describe("POST /admin/bank", () => {
  it("accepts a valid bank draft (all after-lock) and returns an id", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/bank", { method: "POST", body: JSON.stringify(validDraft) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe("string");
  });

  it("rejects a draft with a non-after-lock resolves_at", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const draftWithLock = {
      questions: validDraft.questions.map((q, i) => (i === 0 ? { ...q, resolves_at: "2026-08-27T18:00:00Z" } : q)),
    };
    const res = await admin(app)("/admin/bank", { method: "POST", body: JSON.stringify(draftWithLock) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bank drafts must resolve after the lock");
  });
});

describe("GET /admin/bank", () => {
  it("lists bank drafts and the available count", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await admin(app)("/admin/bank", { method: "POST", body: JSON.stringify(validDraft) });
    const res = await admin(app)("/admin/bank");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: number; drafts: Array<{ id: string; created_at: string; used_on: string | null }> };
    expect(body.available).toBe(1);
    expect(body.drafts).toHaveLength(1);
    expect(body.drafts[0]!.used_on).toBeNull();
  });
});

describe("POST /admin/rounds/:date/author", () => {
  // The nightly cron only ever authors TOMORROW (decideActions gates AUTHOR on
  // hour >= 17 and hardcodes the date). There was no way to ask for a market
  // round on a specific date — so seeding a round by hand meant POSTing a
  // draft, which upsertDraft writes at rules_version 1: the legacy reveal, no
  // duel. This runs the SAME market round the cron runs, for a date you name.
  it("503s when the pipeline isn't configured", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-09/author", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pipeline not configured" });
  });

  it("refuses a date that already has a round, rather than clobbering it", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    const app = createApp({ db, env, pipeline: fakePipeline(db, "2026-09-09T14:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-09-09/author", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "round already exists" });
  });

  it("dispatches authoring for the named date", async () => {
    const { db } = await makeTestDb();
    const started: { kind: string; date: string; roundKind?: string }[] = [];
    const pipeline = {
      ...fakePipeline(db, "2026-09-09T14:00:00Z"),
      workflows: { start: async (_d: unknown, kind: string, _id: string, params: { date: string; roundKind?: string }) => { started.push({ kind, ...params }); } },
    } as unknown as PipelineDeps;
    const app = createApp({ db, env, pipeline });
    const res = await admin(app)("/admin/rounds/2026-09-09/author", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, date: "2026-09-09" });
    expect(started).toEqual([{ kind: "author", date: "2026-09-09", roundKind: "market" }]);
  });

  it("passes ?kind= through to the workflow, and refuses a kind it does not know", async () => {
    const { db } = await makeTestDb();
    const started: { kind: string; date: string; roundKind?: string }[] = [];
    const pipeline = {
      ...fakePipeline(db, "2026-09-09T14:00:00Z"),
      workflows: { start: async (_d: unknown, kind: string, _id: string, params: { date: string; roundKind?: string }) => { started.push({ kind, ...params }); } },
    } as unknown as PipelineDeps;
    const app = createApp({ db, env, pipeline });
    expect((await admin(app)("/admin/rounds/2026-09-23/author?kind=opinion", { method: "POST" })).status).toBe(200);
    expect(started).toEqual([{ kind: "author", date: "2026-09-23", roundKind: "opinion" }]);
    expect((await admin(app)("/admin/rounds/2026-09-24/author?kind=market", { method: "POST" })).status).toBe(200);
    expect(started[1]).toEqual({ kind: "author", date: "2026-09-24", roundKind: "market" });
    const bad = await admin(app)("/admin/rounds/2026-09-25/author?kind=nonsense", { method: "POST" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "unknown round kind" });
  });

  it("POST /rounds/:date/author deals a version 3 round from the injected exchanges", async () => {
    const { db } = await makeTestDb();
    const calls: string[] = [];
    const pipeline = {
      ...fakePipeline(db, "2026-09-09T17:05:00Z"),
      exchangeFeeds: [fiveMarkets("2026-09-10")],
      claude: claudeWith({ calls }),
      marketFetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch,
    };
    const app = createApp({ db, env, pipeline });
    const res = await admin(app)("/admin/rounds/2026-09-10/author", { method: "POST" });
    expect(res.status).toBe(200);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-10") });
    expect(round?.rulesVersion).toBe(3);
  });
});

describe("POST /admin/rounds/:date?rules_version=2", () => {
  // upsertDraft's own default is 1, and the route never passed anything — so
  // every hand-seeded round was legacy, and its reveal showed "N RIGHT · M
  // CALLS READ" with no duel portrait. The default stays 1 so nothing that
  // already posts drafts shifts underneath itself.
  it("seeds at rules_version 1 by default", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-09", { method: "POST", body: JSON.stringify(validDraft) });
    expect(res.status).toBe(200);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-09") });
    expect(round?.rulesVersion).toBe(1);
  });

  it("seeds at rules_version 2 when asked", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-09?rules_version=2", { method: "POST", body: JSON.stringify(validDraft) });
    expect(res.status).toBe(200);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-09") });
    expect(round?.rulesVersion).toBe(2);
  });

  it("rejects a rules_version that is neither 1, 2, nor 3", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-09?rules_version=7", { method: "POST", body: JSON.stringify(validDraft) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "rules_version must be 1, 2, or 3" });
  });
});

describe("POST /admin/rounds/:date?rules_version=3 (crowd)", () => {
  // Spec §8: this route is how a crowd round gets seeded by hand, and §13
  // step 1 relies on it. upsertDraft already enforces that a version 3
  // question names its market; this route only needed to let a crowd draft
  // (rules_version 3) through and turn its rejections into 400s instead of
  // an opaque 500.
  const lock = noonET(addDays("2026-09-23", 1));
  function crowdDraft(closesAt: (slot: number) => string = () => lock.toISOString(), categories = ["markets", "sports", "weather", "culture", "news"] as const) {
    return {
      questions: validDraft.questions.map((q) => ({
        ...q,
        category: categories[q.slot - 1],
        resolution_criteria: CROWD_RESOLUTION_CRITERIA,
        source_name: "THE PLAYERS",
        source_url: "https://outseen-site.etaheri.workers.dev/play",
        author_probability: 0.5,
        market_prob: null,
        resolves_at: RESOLVES_AFTER_LOCK,
        market: { source: "crowd" as const, id: "2026-09-23", event_key: String(q.slot), closes_at: closesAt(q.slot) },
      })),
    };
  }

  it("seeds five market_source = 'crowd' rows at rules_version 3", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-23?rules_version=3", { method: "POST", body: JSON.stringify(crowdDraft()) });
    expect(res.status).toBe(200);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-23") });
    expect(round?.rulesVersion).toBe(3);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-09-23") });
    expect(qs.length).toBe(5);
    expect(qs.every((q) => q.marketSource === "crowd")).toBe(true);
  });

  it("400s the same crowd draft posted at rules_version 2, naming the reason", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-23?rules_version=2", { method: "POST", body: JSON.stringify(crowdDraft()) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "a crowd question needs rules version 3" });
  });
});

describe("POST /admin/rounds/:date/forecast", () => {
  // The Oracle's commitment has exactly one automatic window: hour 9..11 with
  // minute < 10, and stampOracleForecast refuses once the round has opened.
  // A round seeded by hand at 11:15 therefore has no way to ever get one, and
  // silently plays out as "No complete Oracle forecast" — a v2 round with no
  // duel, which is the whole premise missing. This is the manual door.
  it("503s when the pipeline isn't configured", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-09/forecast", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pipeline not configured" });
  });

  it("404s a date with no round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env, pipeline: fakePipeline(db, "2026-09-09T15:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-09-09/forecast", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown round" });
  });

  it("reports why the stamp was refused instead of 500ing", async () => {
    // fakePipeline has claude: null, which stampOracleForecast rejects — the
    // same shape as "round already opened" or a passed deadline.
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-09-09", validDraft, 2);
    const app = createApp({ db, env, pipeline: fakePipeline(db, "2026-09-09T15:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-09-09/forecast", { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toMatch(/claude/i);
  });
});

describe("POST /admin/rounds/:date/council", () => {
  // Same manual door as /forecast, for a version 3 round: the cron dispatches
  // the Council on its own hourly window (pipeline/index.ts's forecast case),
  // and a round seeded outside it otherwise has no way to ever get one.
  it("503s when the pipeline isn't configured", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await admin(app)("/admin/rounds/2026-09-09/council", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pipeline not configured" });
  });

  it("404s a date with no round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env, pipeline: fakePipeline(db, "2026-09-09T15:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-09-09/council", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown round" });
  });

  it("409s a version 2 round", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 2 }).where(eq(schema.rounds.date, "2026-09-09"));
    const app = createApp({ db, env, pipeline: fakePipeline(db, "2026-09-09T15:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-09-09/council", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not a version 3 round" });
  });

  it("409s an already-committed version 3 round", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3, oracleCommittedAt: new Date("2026-09-09T14:00:00Z") }).where(eq(schema.rounds.date, "2026-09-09"));
    const app = createApp({ db, env, pipeline: fakePipeline(db, "2026-09-09T15:00:00Z") });
    const res = await admin(app)("/admin/rounds/2026-09-09/council", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already committed" });
  });

  it("dispatches the council for a scheduled version 3 round", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3 }).where(eq(schema.rounds.date, "2026-09-09"));
    const started: { kind: string; id: string; date: string }[] = [];
    const pipeline = {
      ...fakePipeline(db, "2026-09-09T15:00:00Z"),
      workflows: { start: async (_d: unknown, kind: string, id: string, params: { date: string }) => { started.push({ kind, id, date: params.date }); } },
    } as unknown as PipelineDeps;
    const app = createApp({ db, env, pipeline });
    const res = await admin(app)("/admin/rounds/2026-09-09/council", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; date: string; id: string };
    expect(body.ok).toBe(true);
    expect(body.date).toBe("2026-09-09");
    expect(body.id).toMatch(/^council-2026-09-09-manual-\d+$/);
    expect(started).toEqual([{ kind: "council", id: body.id, date: "2026-09-09" }]);
  });
});

describe("POST /admin/rounds/:date/line", () => {
  it("writes the house line with the admin secret and returns the written count", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const date = "2026-09-09";
    const rows = await seedRound(db, { date, opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    // Migration 0009's commitment guard makes oracle_p_yes immutable once the
    // round carries oracle_committed_at, so probabilities are written FIRST
    // and the round is marked committed LAST — same order as pipeline-line.test.ts.
    for (const r of rows) {
      await db.update(schema.questions).set({ oracleProbYes: "0.5", marketProb: "0.5" }).where(eq(schema.questions.id, r.id));
    }
    await db.update(schema.rounds).set({ rulesVersion: 3, status: "scheduled", oracleCommittedAt: new Date("2026-09-09T14:00:00Z") }).where(eq(schema.rounds.date, date));
    const res = await admin(app)(`/admin/rounds/${date}/line`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ written: 5 });
  });
});

describe("POST /admin/questions/:id/withdraw (design 2026-09-09 §1.4)", () => {
  it("withdraws with the admin secret and returns the remaining count", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    const res = await app.request(`/admin/questions/${qs[3]!.id}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": "admin" },
      body: JSON.stringify({ reason: "unresolvable" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, remaining: 4 });
  });
  it("400s a bad reason, 404s an unknown id, 409s a second withdrawal", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    const post = (id: string, body: unknown) => app.request(`/admin/questions/${id}/withdraw`, { method: "POST", headers: { "content-type": "application/json", "x-admin-secret": "admin" }, body: JSON.stringify(body) });
    expect((await post(qs[0]!.id, { reason: "because" })).status).toBe(400);
    expect((await post("00000000-0000-0000-0000-000000000000", { reason: "misauthored" })).status).toBe(404);
    expect((await post(qs[0]!.id, { reason: "misauthored" })).status).toBe(200);
    expect((await post(qs[0]!.id, { reason: "misauthored" })).status).toBe(409);
  });
});
