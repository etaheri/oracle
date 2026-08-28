import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";
import { settleRound, completeRoundBriers } from "../src/settlement";
import * as schema from "../src/db/schema";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });

// Seed an open round on `date`, optionally place predictions, resolve every
// question, return question rows.
async function playedRound(db: Awaited<ReturnType<typeof makeTestDb>>["db"], app: ReturnType<typeof createApp>, date: string, plays: Array<{ p: (path: string, init?: RequestInit) => Response | Promise<Response>; slots: number[] }>, outcomes: Array<"yes" | "no" | "void"> = ["yes", "yes", "yes", "yes", "yes"]) {
  const qs = await seedRound(db, { date, opensAt: new Date(`${date}T16:00:00Z`), locksAt: new Date(`${date}T17:00:00Z`) });
  for (const { p, slots } of plays) for (const s of slots) await p("/v1/predictions", { method: "POST", body: body(qs.find((q) => q.slot === s)!.id, true) });
  for (const q of qs) await resolveQuestion(db, q.id, outcomes[q.slot - 1]!);
  return qs;
}

afterEach(() => vi.useRealTimers());

describe("settleRound", () => {
  it("increments a played user's streak, is idempotent, marks the round resolved", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);

    const first = await settleRound(db, "2026-08-20");
    expect(first.already).toBe(false);
    expect(first.settled).toBe(1);
    const users = await db.query.users.findMany();
    expect(users[0]).toMatchObject({ streakCurrent: 1, streakBest: 1 });
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-20") });
    expect(round!.status).toBe("resolved");

    const second = await settleRound(db, "2026-08-20");
    expect(second.already).toBe(true);
    expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(1); // not double-settled
  });

  it("a miss consumes the free monthly shield, then a paid shield, then resets", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    // day 1: played, streak 1
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    const uid = (await db.query.users.findMany())[0]!.id;
    // day 2: miss → free shield holds the streak
    await playedRound(db, app, "2026-08-21", []);
    await settleRound(db, "2026-08-21");
    let u = (await db.query.users.findMany())[0]!;
    expect(u).toMatchObject({ streakCurrent: 1, freeShieldUsedAt: "2026-08-21" });
    // day 3: miss, free shield spent this month, one paid shield available
    await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 1 });
    await playedRound(db, app, "2026-08-22", []);
    await settleRound(db, "2026-08-22");
    u = (await db.query.users.findMany())[0]!;
    expect(u.streakCurrent).toBe(1);
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
    expect(ent!.shieldsRemaining).toBe(0);
    // day 4: miss, no shields left → reset
    await playedRound(db, app, "2026-08-23", []);
    await settleRound(db, "2026-08-23");
    expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(0);
  });

  it("a complete round feeds calls_resolved (non-void count); score stays null under the minimum; a void slot still credits the streak", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2, 3, 4, 5] }], ["yes", "yes", "yes", "yes", "void"]);
    await settleRound(db, "2026-08-20");
    const u = (await db.query.users.findMany())[0]!;
    expect(u).toMatchObject({ streakCurrent: 1, callsResolved: 4, oracleScore: null });
  });

  it("a partial round grants streak but not calls_resolved", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2] }]);
    await settleRound(db, "2026-08-20");
    expect((await db.query.users.findMany())[0]!).toMatchObject({ streakCurrent: 1, callsResolved: 0 });
  });

  it("oracle score only counts fully resolved rounds, or the round being settled now", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);

    // Round A: fully played and resolved, then settled.
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2, 3, 4, 5] }]);
    await settleRound(db, "2026-08-20");
    const uid = (await db.query.users.findMany())[0]!.id;

    // Round B: same player answers all 5, but only 3 questions get resolved — round B is NOT settled.
    const qsB = await seedRound(db, { date: "2026-08-21", opensAt: new Date("2026-08-21T16:00:00Z"), locksAt: new Date("2026-08-21T17:00:00Z") });
    for (const s of [1, 2, 3, 4, 5]) await a("/v1/predictions", { method: "POST", body: body(qsB.find((q) => q.slot === s)!.id, true) });
    for (const q of qsB.filter((q) => q.slot <= 3)) await resolveQuestion(db, q.id, "yes");

    expect(await completeRoundBriers(db, uid, "2026-08-20")).toHaveLength(5); // B's 3 resolved briers do not leak in
    expect(await completeRoundBriers(db, uid, "2026-08-21")).toHaveLength(8); // A's 5 + B's 3, since B is the round being settled now
  });

  it("a cron retry after a mid-loop crash does not double-settle a played user", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    // Simulate the crash window: users were settled but the round never flipped.
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-20"));

    const retry = await settleRound(db, "2026-08-20");
    expect(retry.settled).toBe(0);
    expect((await db.query.users.findMany())[0]!).toMatchObject({ streakCurrent: 1, streakBest: 1, streakSettledThrough: "2026-08-20" });
  });

  it("a cron retry does not burn a second shield", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    const uid = (await db.query.users.findMany())[0]!.id;
    // Free shield already spent this month; one paid shield in reserve.
    await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-20" }).where(eq(schema.users.id, uid));
    await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 1 });
    // Day 2: a miss → the paid shield burns once.
    await playedRound(db, app, "2026-08-21", []);
    await settleRound(db, "2026-08-21");
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-21"));

    await settleRound(db, "2026-08-21"); // the retry
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
    expect(ent!.shieldsRemaining).toBe(0); // burned once, not twice
    expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(1);
  });
});

describe("POST /admin/rounds/:date/settle", () => {
  it("guards on secret, unknown round, and unresolved questions", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const admin = (path: string) => app.request(path, { method: "POST", headers: { "x-admin-secret": "admin" } });
    expect((await app.request("/admin/rounds/2026-08-20/settle", { method: "POST" })).status).toBe(401);
    expect((await admin("/admin/rounds/2026-08-20/settle")).status).toBe(404);
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-20T17:00:00Z") });
    expect((await admin("/admin/rounds/2026-08-20/settle")).status).toBe(409); // questions still open
  });

  it("returns 500 and leaks nothing on an internal failure", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db, pg } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await pg.exec("DROP TABLE entitlements");

    const admin = (path: string) => app.request(path, { method: "POST", headers: { "x-admin-secret": "admin" } });
    const res = await admin("/admin/rounds/2026-08-20/settle");
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "settle failed" });
    expect(JSON.stringify(json).toLowerCase()).not.toContain("select");
  });
});
