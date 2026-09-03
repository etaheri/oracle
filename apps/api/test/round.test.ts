import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";
import { and, eq, ne } from "drizzle-orm";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function authedApp() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = (await res.json()) as { token: string };
  const authed = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return { app, db, authed };
}

afterEach(() => vi.useRealTimers());

describe("GET /v1/round/today", () => {
  it("401s without a token", async () => {
    const { app } = await authedApp();
    expect((await app.request("/v1/round/today")).status).toBe(401);
  });
  it("404s when no open round", async () => {
    const { authed } = await authedApp();
    expect((await authed("/v1/round/today")).status).toBe(404);
  });
  it("returns the open round's questions, slot-ordered, without spoilers", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db, authed } = await authedApp();
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await authed("/v1/round/today");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; questions: Array<Record<string, unknown>> };
    expect(body.date).toBe("2026-08-20");
    expect(body.questions.map((q) => q.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(body.questions[4]!.is_big_one).toBe(true);
    for (const q of body.questions) {
      expect(q).not.toHaveProperty("crowd_yes_pct");
      expect(q).not.toHaveProperty("outcome");
      expect(q.locks_at).toBe("2026-08-21T16:00:00.000Z");
    }
  });
  it("counts distinct players who have sealed at least one answer", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { app, db, authed } = await authedApp();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });

    const res2 = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
    const { token: t2 } = (await res2.json()) as { token: string };
    const authed2 = (path: string, init: RequestInit = {}) =>
      app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${t2}` } });

    const submit = (p: typeof authed, qid: string) =>
      p("/v1/predictions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question_id: qid, answer: true, confidence: 75, idempotency_key: "k" }) });
    await submit(authed, qs[0]!.id);
    await submit(authed, qs[1]!.id); // same player twice — still one oracle
    await submit(authed2, qs[0]!.id);

    const body = (await (await authed("/v1/round/today")).json()) as { player_count: number };
    expect(body.player_count).toBe(2);
  });
  it("does not serve a round whose lock time has passed, even if the cron has not flipped it", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-21T16:05:00Z"), toFake: ["Date"] });
    const { db, authed } = await authedApp();
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    expect((await authed("/v1/round/today")).status).toBe(404);
    expect((await authed("/v1/round/today/crowd")).status).toBe(404);
  });
  it("serves the earliest live round when two are open, and carries per-question locks_at", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-21T12:00:00Z"), toFake: ["Date"] });
    const { db, authed } = await authedApp();
    await seedRound(db, { date: "2026-08-21", opensAt: new Date("2026-08-21T16:00:00Z"), locksAt: new Date("2026-08-22T16:00:00Z") });
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const body = (await (await authed("/v1/round/today")).json()) as { date: string; locks_at: string; questions: Array<{ locks_at: string }> };
    expect(body.date).toBe("2026-08-20");
    expect(body.locks_at).toBe("2026-08-21T16:00:00.000Z");
    expect(body.questions.every((q) => q.locks_at === "2026-08-21T16:00:00.000Z")).toBe(true);
  });
});

describe("GET /v1/round/next", () => {
  it("404s with nothing scheduled", async () => {
    const { authed } = await authedApp();
    expect((await authed("/v1/round/next")).status).toBe(404);
  });
  it("returns the earliest scheduled round's noon ET", async () => {
    const { db, authed } = await authedApp();
    await db.insert(schema.rounds).values([{ date: "2026-08-23", status: "scheduled" }, { date: "2026-08-22", status: "scheduled" }]);
    expect(await (await authed("/v1/round/next")).json()).toEqual({ date: "2026-08-22", opens_at: "2026-08-22T16:00:00.000Z" });
  });
});

// ---------------------------------------------------------------------------
// The daily board (design 2026-09-03 §4). The day, not the record: it works on
// install day, it ranks one round, and nothing purchasable can reach it.
// ---------------------------------------------------------------------------

const RESOLVED_ALL = { outcome: "yes" as const, status: "resolved" as const };

/** A fresh device + the user it minted, so a test can write that user's ledger directly. */
async function newPlayer(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token, user_id } = (await res.json()) as { token: string; user_id: string };
  return {
    userId: user_id,
    get: (path: string) => app.request(path, { headers: { authorization: `Bearer ${token}` } }),
  };
}

/** Seal a player's day at chosen RAW per-question points — the board's only input. */
async function seal(
  db: Awaited<ReturnType<typeof makeTestDb>>["db"],
  userId: string,
  qs: Array<{ id: string }>,
  points: number[],
  opts: { firstHour?: boolean; vigilMult?: number; date?: string } = {},
) {
  await db.insert(schema.predictions).values(
    points.map((pts, i) => ({
      questionId: qs[i]!.id,
      userId,
      answer: true,
      confidence: 75,
      firstHour: opts.firstHour ?? false,
      points: pts,
    })),
  );
  if (opts.vigilMult !== undefined) {
    await db.insert(schema.userRounds).values({ userId, date: opts.date!, vigilMult: String(opts.vigilMult) });
  }
}

interface Board {
  date: string;
  field_size: number;
  your_points: number | null;
  your_rank: number | null;
  best_points: number | null;
  median_points: number | null;
}

async function boardFixture(points: number[][]) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
  const players = [];
  for (const pts of points) {
    const p = await newPlayer(app);
    await seal(db, p.userId, qs, pts);
    players.push(p);
  }
  await db.update(schema.questions).set(RESOLVED_ALL).where(eq(schema.questions.roundDate, "2026-08-20"));
  return { db, app, qs, players };
}

describe("GET /v1/round/:date/board", () => {
  it("401s without a token", async () => {
    const { app } = await authedApp();
    expect((await app.request("/v1/round/2026-08-20/board")).status).toBe(401);
  });

  it("404s on a date that asked no questions", async () => {
    const { authed } = await authedApp();
    expect((await authed("/v1/round/2026-08-20/board")).status).toBe(404);
  });

  // THE test. Money must not buy the board: the vigil multiplier is defended
  // by a purchasable shield, so a long vigil over a worse day must still lose
  // to a better raw day. Same for the first hour, which is a timing edge.
  it("ranks on raw points, so neither a long vigil nor the first hour outranks a better day", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });

    // A: 100 raw, weighed ×1.5 by a ten-day vigil AND sealed inside the first
    // hour — 165 day points, the biggest number on the screen that day.
    const a = await newPlayer(app);
    await seal(db, a.userId, qs, [20, 20, 20, 20, 20], { firstHour: true, vigilMult: 1.5, date: "2026-08-20" });
    // B: 120 raw, no vigil, no first hour — 120 day points, and the better day.
    const b = await newPlayer(app);
    await seal(db, b.userId, qs, [24, 24, 24, 24, 24], { vigilMult: 1, date: "2026-08-20" });
    for (const pts of [[10, 10, 10, 10, 10], [8, 8, 8, 8, 8], [6, 6, 6, 6, 6]]) {
      const f = await newPlayer(app);
      await seal(db, f.userId, qs, pts);
    }
    await db.update(schema.questions).set(RESOLVED_ALL).where(eq(schema.questions.roundDate, "2026-08-20"));

    const ba = (await (await a.get("/v1/round/2026-08-20/board")).json()) as Board;
    const bb = (await (await b.get("/v1/round/2026-08-20/board")).json()) as Board;
    expect(ba.your_points).toBe(100);
    expect(ba.your_rank).toBe(2);
    expect(bb.your_points).toBe(120);
    expect(bb.your_rank).toBe(1);
    expect(ba.best_points).toBe(120);
    expect(ba.field_size).toBe(5);
  });

  it("shares the better rank across a tie", async () => {
    const { players } = await boardFixture([
      [20, 20, 20, 20, 20], // 100
      [20, 20, 20, 20, 20], // 100
      [16, 16, 16, 16, 16], // 80
      [12, 12, 12, 12, 12], // 60
      [8, 8, 8, 8, 8],      // 40
    ]);
    const ranks: Array<number | null> = [];
    for (const p of players) ranks.push(((await (await p.get("/v1/round/2026-08-20/board")).json()) as Board).your_rank);
    expect(ranks).toEqual([1, 1, 3, 4, 5]);
  });

  it("reads the median of the field, odd and even", async () => {
    const odd = await boardFixture([[20, 20, 20, 20, 20], [20, 20, 20, 20, 20], [16, 16, 16, 16, 16], [12, 12, 12, 12, 12], [8, 8, 8, 8, 8]]);
    const bodd = (await (await odd.players[0]!.get("/v1/round/2026-08-20/board")).json()) as Board;
    expect(bodd.median_points).toBe(80);

    // Even field: 100, 100, 80, 60, 40, 20 → the two middles are 80 and 60.
    const even = await boardFixture([[20, 20, 20, 20, 20], [20, 20, 20, 20, 20], [16, 16, 16, 16, 16], [12, 12, 12, 12, 12], [8, 8, 8, 8, 8], [4, 4, 4, 4, 4]]);
    const beven = (await (await even.players[0]!.get("/v1/round/2026-08-20/board")).json()) as Board;
    expect(beven.median_points).toBe(70);
  });

  it("keeps a losing day on the board", async () => {
    const { players } = await boardFixture([
      [-20, -20, -20, -20, -20],
      [-16, -16, -16, -16, -16],
      [-12, -12, -12, -12, -12],
      [-8, -8, -8, -8, -8],
      [-4, -4, -4, -4, -4],
    ]);
    const worst = (await (await players[0]!.get("/v1/round/2026-08-20/board")).json()) as Board;
    expect(worst.your_points).toBe(-100);
    expect(worst.your_rank).toBe(5);
    expect(worst.best_points).toBe(-20);
    expect(worst.median_points).toBe(-60);
  });

  it("counts only complete rounds, and gives a partial player no rank", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    for (const pts of [[20, 20, 20, 20, 20], [16, 16, 16, 16, 16], [12, 12, 12, 12, 12], [8, 8, 8, 8, 8], [4, 4, 4, 4, 4]]) {
      const f = await newPlayer(app);
      await seal(db, f.userId, qs, pts);
    }
    // One question, and the biggest single score of the day — cherry-picking
    // must buy nothing, not even a place in the field.
    const partial = await newPlayer(app);
    await seal(db, partial.userId, qs.slice(0, 1), [500]);
    await db.update(schema.questions).set(RESOLVED_ALL).where(eq(schema.questions.roundDate, "2026-08-20"));

    const body = (await (await partial.get("/v1/round/2026-08-20/board")).json()) as Board;
    expect(body.field_size).toBe(5);
    expect(body.your_points).toBeNull();
    expect(body.your_rank).toBeNull();
    expect(body.best_points).toBe(100); // not 500
    expect(body.median_points).toBe(60);
  });

  it("holds its tongue under the field floor, but still owns the caller's own number", async () => {
    const { players } = await boardFixture([[20, 20, 20, 20, 20], [16, 16, 16, 16, 16], [12, 12, 12, 12, 12], [8, 8, 8, 8, 8]]);
    const body = (await (await players[0]!.get("/v1/round/2026-08-20/board")).json()) as Board;
    expect(body.field_size).toBe(4);
    expect(body.your_points).toBe(100);
    expect(body.your_rank).toBeNull();
    expect(body.best_points).toBeNull();
    expect(body.median_points).toBeNull();
  });

  it("withholds a partially-read day entirely", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const p = await newPlayer(app);
    await seal(db, p.userId, qs, [20, 20, 20, 20, 20]);
    // Four of five read. A provisional rank is the same broken promise as a
    // provisional score.
    await db.update(schema.questions).set(RESOLVED_ALL).where(and(eq(schema.questions.roundDate, "2026-08-20"), ne(schema.questions.slot, 5)));
    expect((await p.get("/v1/round/2026-08-20/board")).status).toBe(409);

    await db.update(schema.questions).set({ outcome: "void", status: "void" }).where(eq(schema.questions.slot, 5));
    // A void question carries an outcome, so the day is read.
    expect((await p.get("/v1/round/2026-08-20/board")).status).toBe(200);
  });

  it("returns aggregates and the caller's own row, and nobody's identity", async () => {
    const { players } = await boardFixture([[20, 20, 20, 20, 20], [16, 16, 16, 16, 16], [12, 12, 12, 12, 12], [8, 8, 8, 8, 8], [4, 4, 4, 4, 4]]);
    const res = await players[2]!.get("/v1/round/2026-08-20/board");
    const raw = await res.text();
    const body = JSON.parse(raw) as Board;
    expect(Object.keys(body).sort()).toEqual(["best_points", "date", "field_size", "median_points", "your_points", "your_rank"]);
    for (const p of players) expect(raw).not.toContain(p.userId);
  });
});
