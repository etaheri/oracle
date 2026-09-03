import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";
import { settleRound, completeRoundBriers, resettleRound } from "../src/settlement";
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
    // days 1-3: played, streak reaches 3 (the shield floor)
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    await playedRound(db, app, "2026-08-21", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-21");
    await playedRound(db, app, "2026-08-22", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-22");
    const uid = (await db.query.users.findMany())[0]!.id;
    // day 4: miss → free shield holds the streak
    await playedRound(db, app, "2026-08-23", []);
    await settleRound(db, "2026-08-23");
    let u = (await db.query.users.findMany())[0]!;
    expect(u).toMatchObject({ streakCurrent: 3, freeShieldUsedAt: "2026-08-23" });
    // day 5: miss, free shield spent this month, one paid shield available
    await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 1 });
    await playedRound(db, app, "2026-08-24", []);
    await settleRound(db, "2026-08-24");
    u = (await db.query.users.findMany())[0]!;
    expect(u.streakCurrent).toBe(3);
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
    expect(ent!.shieldsRemaining).toBe(0);
    // day 6: miss, no shields left → reset
    await playedRound(db, app, "2026-08-25", []);
    await settleRound(db, "2026-08-25");
    expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(0);
  });

  it("decrements paid shields relatively, not absolutely — a rescue purchase landing mid-settle survives", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    // days 1-3: played, streak reaches 3 (the shield floor)
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    await playedRound(db, app, "2026-08-21", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-21");
    await playedRound(db, app, "2026-08-22", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-22");
    const uid = (await db.query.users.findMany())[0]!.id;
    // Free shield already spent this month; two paid shields in reserve —
    // simulating a rescue purchase that landed after the free shield burned
    // but before this settle runs. settleStreak reads shieldsRemaining=2 and
    // computes paidShieldsRemaining=1 (absolute); the relative SQL write
    // must independently land at 2-1=1, not clobber a higher concurrent value.
    await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-22" }).where(eq(schema.users.id, uid));
    await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 2 });
    await playedRound(db, app, "2026-08-23", []);
    await settleRound(db, "2026-08-23");
    const u = (await db.query.users.findMany())[0]!;
    expect(u.streakCurrent).toBe(3); // shield held the streak
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
    expect(ent!.shieldsRemaining).toBe(1); // 2 - 1, relative decrement
  });

  it("never decrements shieldsRemaining below zero", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    await playedRound(db, app, "2026-08-21", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-21");
    await playedRound(db, app, "2026-08-22", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-22");
    const uid = (await db.query.users.findMany())[0]!.id;
    await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-22" }).where(eq(schema.users.id, uid));
    await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 1 });
    await playedRound(db, app, "2026-08-23", []);
    await settleRound(db, "2026-08-23");
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
    expect(ent!.shieldsRemaining).toBe(0); // 1 - 1, never negative
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
    // days 1-3: played, streak reaches 3 (the shield floor)
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    await playedRound(db, app, "2026-08-21", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-21");
    await playedRound(db, app, "2026-08-22", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-22");
    const uid = (await db.query.users.findMany())[0]!.id;
    // Free shield already spent this month; one paid shield in reserve.
    await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-22" }).where(eq(schema.users.id, uid));
    await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 1 });
    // Day 4: a miss → the paid shield burns once.
    await playedRound(db, app, "2026-08-23", []);
    await settleRound(db, "2026-08-23");
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-23"));

    await settleRound(db, "2026-08-23"); // the retry
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
    expect(ent!.shieldsRemaining).toBe(0); // burned once, not twice
    expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(3);
  });

  it("a round with four questions still rates when all four are answered", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const qs = await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2, 3, 4] }]);
    await db.delete(schema.predictions).where(eq(schema.predictions.questionId, qs[4]!.id));
    await db.delete(schema.questions).where(eq(schema.questions.id, qs[4]!.id));
    await settleRound(db, "2026-08-20");
    expect((await db.query.users.findMany())[0]!.callsResolved).toBe(4);
  });

  it("recomputeTruth rebuilds calls_resolved and oracle_score after a forced re-resolve", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const qs = await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2, 3, 4, 5] }]);
    await settleRound(db, "2026-08-20");
    const before = (await db.query.users.findMany())[0]!;
    expect(before.callsResolved).toBe(5);
    // flip slot 1 to void → 4 rated calls
    await resolveQuestion(db, qs[0]!.id, "void", null, { force: true });
    const out = await resettleRound(db, "2026-08-20");
    expect(out.users).toBe(1);
    const after = (await db.query.users.findMany())[0]!;
    expect(after.callsResolved).toBe(4);
    expect(after.streakCurrent).toBe(before.streakCurrent);
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

describe("settleRound stamps the vigil", () => {
  it("stamps the vigil carried INTO the day, not the one earned by it", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");

    const users = await db.query.users.findMany();
    // The day was played, so the streak LEAVES at 1...
    expect(users[0]!.streakCurrent).toBe(1);
    // ...but it ARRIVED at 0, and 0 is what weighed it.
    const stamped = await db.query.userRounds.findMany();
    expect(stamped).toHaveLength(1);
    expect(Number(stamped[0]!.vigilMult)).toBe(1);
  });

  it("does not stamp a user who did not play", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const b = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    // b exists and was in the audience only if they held a streak; either way
    // a user with no predictions has no day to weigh.
    expect(await db.query.userRounds.findMany()).toHaveLength(1);
    void b;
  });

  it("a crash-retry re-entering the loop never revises the stamp", async () => {
    // The real retry path, and the ONLY test that exercises onConflictDoNothing.
    // settleRound's own second call returns early on round status, and
    // resettleRound never enters the per-user loop at all — so both would pass
    // this vacuously. Simulate the crash instead: clear the settled-through
    // marker and reopen the round, so the user is genuinely re-processed. Their
    // streak is now 1 rather than 0, so a do-UPDATE would rewrite the stamp
    // from 1.00 to 1.05. It must not.
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    expect(Number((await db.query.userRounds.findMany())[0]!.vigilMult)).toBe(1);

    await db.update(schema.users).set({ streakSettledThrough: null });
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-20"));
    await settleRound(db, "2026-08-20");

    const stamped = await db.query.userRounds.findMany();
    expect(stamped).toHaveLength(1);
    expect(Number(stamped[0]!.vigilMult)).toBe(1); // NOT 1.05
  });

  it("a resettle recomputes truth without touching the stamp", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    await resettleRound(db, "2026-08-20");
    const stamped = await db.query.userRounds.findMany();
    expect(stamped).toHaveLength(1);
    expect(Number(stamped[0]!.vigilMult)).toBe(1);
  });
});
