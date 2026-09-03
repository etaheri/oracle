import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean, confidence = 85) =>
  JSON.stringify({ question_id: q, answer, confidence, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("GET /v1/me/ledger", () => {
  it("computes stats and a tide win from the caller's resolved record", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    // a stands alone on YES; crowd is 1/3 = 33% yes → a's side is 33 (<40)
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await resolveQuestion(db, qs[0]!.id, "yes");

    const res = await a("/v1/me/ledger");
    expect(res.status).toBe(200);
    const out = (await res.json()) as Record<string, unknown>;
    expect(out).toMatchObject({
      days_consulted: 1,
      accuracy_pct: 100,
      avg_confidence: 85,
      // Only 3 players saw this question — under CONTRARIAN_MIN_CROWD (20),
      // so a's correct minority call does not earn a tide win.
      tide_wins: 0,
      majority_rate: 0,
      computed_through: "2026-08-20",
    });
    expect(Number.isInteger(out.calls_rated)).toBe(true);
    expect(Number.isInteger(out.calls_answered)).toBe(true);
    expect((out.epithet as { id: string }).id).toBe("unread"); // < 5 complete rounds

    const resB = await b("/v1/me/ledger");
    const outB = (await resB.json()) as Record<string, unknown>;
    expect(outB).toMatchObject({ accuracy_pct: 0, tide_wins: 0, majority_rate: 1 });
  });

  it("counts a tide win only once the crowd clears the 20-player floor", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const caller = await player(app);
    for (let i = 0; i < 20; i++) {
      const p = await player(app);
      await p("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    }
    // caller stands alone on YES against a 20-strong NO crowd — side% is well under 40
    await caller("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await resolveQuestion(db, qs[0]!.id, "yes");

    const out = (await (await caller("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ tide_wins: 1 });
  });

  it("exposes calls_rated (score-feeding) and calls_answered (all resolved)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    // a answers only slots 1..3 of the 5-question round
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await a("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) });
    await a("/v1/predictions", { method: "POST", body: body(qs[2]!.id, true) });
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, "2026-08-20");

    const out = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    // incomplete round (3 of 5 answered) does not rate, but every resolved call still counts as answered
    expect(out).toMatchObject({ calls_answered: 3, calls_rated: 0 });
  });

  it("void outcomes are excluded; a fresh player gets the null shape", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) });
    await resolveQuestion(db, qs[1]!.id, "void");

    const out = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ days_consulted: 1, accuracy_pct: null, avg_confidence: null, tide_wins: 0, majority_rate: null });

    const fresh = await player(app);
    const outF = (await (await fresh("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(outF).toMatchObject({ days_consulted: 0, accuracy_pct: null, streak: 0, claimed: false });
    expect((outF.epithet as { id: string }).id).toBe("unread");
  });

  it("reports shield state: monthly free shield, paid reserve, last hold date", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);

    const fresh = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(fresh).toMatchObject({ free_shield_available: true, paid_shields: 0, shield_used_on: null });

    const uid = (await db.query.users.findMany())[0]!.id;
    await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-19" }).where(eq(schema.users.id, uid));
    await db.insert(schema.entitlements).values({ userId: uid, shieldsRemaining: 2 });

    const spent = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(spent).toMatchObject({ free_shield_available: false, paid_shields: 2, shield_used_on: "2026-08-19" });
  });
});

describe("standing", () => {
  const withScore = async (db: Awaited<ReturnType<typeof makeTestDb>>["db"], score: number | null) =>
    (await db.insert(schema.users).values({ oracleScore: score, callsResolved: score === null ? 0 : 50 }).returning())[0]!;

  it("is null for a player whose score is unwritten", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const res = await a("/v1/me/ledger");
    const body = (await res.json()) as { percentile: number | null };
    expect(body.percentile).toBeNull();
  });

  it("is null while the cohort is too small to mean anything", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const [me] = await db.query.users.findMany();
    await db.update(schema.users).set({ oracleScore: 700, callsResolved: 50 }).where(eq(schema.users.id, me!.id));
    for (let i = 0; i < 5; i++) await withScore(db, 600);
    const body = (await (await a("/v1/me/ledger")).json()) as { percentile: number | null; cohort_size: number };
    expect(body.cohort_size).toBe(6);
    expect(body.percentile).toBeNull();
  });

  it("reports the share of the cohort standing below, once the cohort is large enough", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const [me] = await db.query.users.findMany();
    await db.update(schema.users).set({ oracleScore: 900, callsResolved: 50 }).where(eq(schema.users.id, me!.id));
    // 19 others, all below → 19 of 20 below → 95th.
    for (let i = 0; i < 19; i++) await withScore(db, 500);
    const body = (await (await a("/v1/me/ledger")).json()) as { percentile: number | null; cohort_size: number };
    expect(body.cohort_size).toBe(20);
    expect(body.percentile).toBe(95);
  });

  it("does not count unwritten scores in the cohort", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const [me] = await db.query.users.findMany();
    await db.update(schema.users).set({ oracleScore: 900, callsResolved: 50 }).where(eq(schema.users.id, me!.id));
    for (let i = 0; i < 19; i++) await withScore(db, 500);
    for (let i = 0; i < 30; i++) await withScore(db, null);
    const body = (await (await a("/v1/me/ledger")).json()) as { cohort_size: number };
    expect(body.cohort_size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// The ledger's rival: THE ORACLE's own record, on the same fifty-call floor
// the player meets.
// ---------------------------------------------------------------------------

/** A fresh device + the user it minted, so a fixture can seed that user's own record. */
async function freshPlayer(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token, user_id } = (await res.json()) as { token: string; user_id: string };
  return {
    userId: user_id,
    get: (path: string) => app.request(path, { headers: { authorization: `Bearer ${token}` } }),
  };
}

/**
 * Seal one round directly at the DB layer (bypassing /v1/predictions, so no
 * fake clock is needed): the caller answers every question, the Oracle
 * forecasts every question, and each question resolves to the given outcome.
 */
async function sealDay(
  db: Awaited<ReturnType<typeof makeTestDb>>["db"],
  userId: string,
  qs: Array<{ id: string; slot: number }>,
  rows: Array<{ outcome: "yes" | "no" | "void"; playerAnswer: boolean; oracleP: number }>,
) {
  for (let i = 0; i < qs.length; i++) {
    const r = rows[i]!;
    await db.insert(schema.predictions).values({ questionId: qs[i]!.id, userId, answer: r.playerAnswer, confidence: 75 });
    await db.update(schema.questions).set({ oracleProbYes: String(r.oracleP) }).where(eq(schema.questions.id, qs[i]!.id));
    await resolveQuestion(db, qs[i]!.id, r.outcome);
  }
}

/** A fresh device, no rounds played, and no Oracle forecasts anywhere. */
async function newPlayer() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  return freshPlayer(app);
}

/**
 * Two complete rounds. Day 1: the player gets 4 of 5 right, the Oracle 3 --
 * the player outseeing it. Day 2: the player gets 2 right, the Oracle 4 --
 * the Oracle outseeing the player, which must NOT count as outseen.
 */
async function twoDayPlayer() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const p = await freshPlayer(app);
  const day1 = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
  await sealDay(db, p.userId, day1, [
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "yes", playerAnswer: true, oracleP: 0.3 }, // player right, Oracle wrong
    { outcome: "yes", playerAnswer: false, oracleP: 0.3 }, // both wrong
  ]); // player 4 right, Oracle 3 right
  const day2 = await seedRound(db, { date: "2026-08-22", opensAt: new Date("2026-08-22T16:00:00Z"), locksAt: new Date("2026-08-23T16:00:00Z") });
  await sealDay(db, p.userId, day2, [
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "yes", playerAnswer: false, oracleP: 0.8 }, // Oracle right, player wrong
    { outcome: "yes", playerAnswer: false, oracleP: 0.8 }, // Oracle right, player wrong
    { outcome: "yes", playerAnswer: false, oracleP: 0.3 }, // both wrong
  ]); // player 2 right, Oracle 4 right
  return p;
}

/** One complete round: the player and the Oracle each get 3 of 5 right. A tie. */
async function tiedPlayer() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const p = await freshPlayer(app);
  const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
  await sealDay(db, p.userId, qs, [
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "yes", playerAnswer: true, oracleP: 0.3 }, // player right, Oracle wrong
    { outcome: "yes", playerAnswer: false, oracleP: 0.8 }, // Oracle right, player wrong
    { outcome: "yes", playerAnswer: false, oracleP: 0.3 }, // both wrong
  ]); // 3 right each
  return p;
}

/** One round, sealed by the caller for only 3 of its 5 questions -- incomplete. */
async function partialPlayer() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const p = await freshPlayer(app);
  const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
  for (const q of qs) await db.update(schema.questions).set({ oracleProbYes: "0.8" }).where(eq(schema.questions.id, q.id));
  for (let i = 0; i < 3; i++) await db.insert(schema.predictions).values({ questionId: qs[i]!.id, userId: p.userId, answer: true, confidence: 75 });
  for (const q of qs) await resolveQuestion(db, q.id, "yes");
  return p;
}

/**
 * One complete round with two voids and one Oracle abstention (pYes = 0.5,
 * an uncalled question). Both sides' right-counts must skip all three,
 * without stopping the day from counting as compared.
 */
async function voidHeavyPlayer() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const p = await freshPlayer(app);
  const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
  await sealDay(db, p.userId, qs, [
    { outcome: "void", playerAnswer: true, oracleP: 0.8 },
    { outcome: "void", playerAnswer: true, oracleP: 0.3 },
    { outcome: "yes", playerAnswer: true, oracleP: 0.5 }, // Oracle abstains
    { outcome: "yes", playerAnswer: true, oracleP: 0.8 }, // both right
    { outcome: "no", playerAnswer: false, oracleP: 0.2 }, // both right
  ]);
  return p;
}

async function ledgerFor(setup: () => Promise<Awaited<ReturnType<typeof freshPlayer>>>) {
  const p = await setup();
  return (await p.get("/v1/me/ledger")).json();
}

interface LedgerBody {
  oracle: { score: number | null; calls_rated: number; days_outseen: number; days_compared: number };
}

describe("the ledger's rival", () => {
  it("reads UNWRITTEN for the machine below the fifty-call floor", async () => {
    const body = (await ledgerFor(newPlayer)) as LedgerBody;
    expect(body.oracle.score).toBeNull();
    expect(body.oracle.calls_rated).toBeGreaterThanOrEqual(0);
  });
  it("counts a complete day the player won as outseen", async () => {
    // Seeded: 2 complete rounds. Day 1 player 4 right / oracle 3.
    //         Day 2 player 2 right / oracle 4.
    const body = (await ledgerFor(twoDayPlayer)) as LedgerBody;
    expect(body.oracle.days_compared).toBe(2);
    expect(body.oracle.days_outseen).toBe(1);
  });
  it("never counts a tie as outseeing", async () => {
    const body = (await ledgerFor(tiedPlayer)) as LedgerBody; // 3 right each, one round
    expect(body.oracle.days_compared).toBe(1);
    expect(body.oracle.days_outseen).toBe(0);
  });
  it("compares only complete rounds", async () => {
    const body = (await ledgerFor(partialPlayer)) as LedgerBody; // sealed 3 of 5, one round
    expect(body.oracle.days_compared).toBe(0);
    expect(body.oracle.days_outseen).toBe(0);
  });
  it("excludes voids and the machine's abstentions from both sides", async () => {
    const body = (await ledgerFor(voidHeavyPlayer)) as LedgerBody;
    expect(body.oracle.days_compared).toBe(1);
  });
});
