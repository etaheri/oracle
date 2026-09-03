import { describe, expect, it, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { upsertDraft } from "../src/pipeline/draft";
import type { PipelineDeps } from "../src/pipeline";
import * as schema from "../src/db/schema";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

afterEach(() => vi.useRealTimers());

function admin(app: ReturnType<typeof createApp>) {
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), "x-admin-secret": "admin", "content-type": "application/json" } });
}

function fakePipeline(db: PipelineDeps["db"], nowIso: string): PipelineDeps {
  return {
    db, claude: null, models: { author: "m-a", resolve: "m-r", forecast: "m-f" },
    telegram: { send: async () => {} },
    now: () => new Date(nowIso),
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

describe("GET /admin/analytics/leak", () => {
  it("requires the admin secret", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await app.request("/admin/analytics/leak");
    expect(res.status).toBe(401);
  });

  it("pools every resolved round and carries the caveat", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await app.request("/admin/analytics/leak", { headers: { "x-admin-secret": "admin" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pooled: { seals: number; questions: number }; rounds: unknown[]; caveat: string };
    expect(body.pooled.seals).toBe(0);
    expect(body.pooled.questions).toBe(0);
    expect(Array.isArray(body.rounds)).toBe(true);
    expect(body.caveat.length).toBeGreaterThan(0);
  });

  it("honours ?since", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await seedRound(db, { date: "2026-08-25", opensAt: new Date("2026-08-25T16:00:00Z"), locksAt: new Date("2026-08-26T16:00:00Z") });
    const res = await app.request("/admin/analytics/leak?since=2026-08-25", { headers: { "x-admin-secret": "admin" } });
    const body = (await res.json()) as { rounds: Array<{ date: string }> };
    expect(body.rounds.every((r) => r.date >= "2026-08-25")).toBe(true);
  });
});
