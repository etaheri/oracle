import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { CONSTANTS, PIPELINE_LINES } from "@oracle/core";
import { resolveQuestion, withdrawQuestion } from "../src/resolution";

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
  rows: Array<{ name: string; points: number; rank: number; is_you: boolean; is_oracle: boolean }>;
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
    expect(Object.keys(body).sort()).toEqual(["best_points", "date", "field_size", "median_points", "rows", "your_points", "your_rank"]);
    for (const p of players) expect(raw).not.toContain(p.userId);
  });
});

// ---------------------------------------------------------------------------
// The board's rows (design 2026-09-03 §4): a ranked LIST of machine-assigned
// designations, THE ORACLE standing in it as a row.
// ---------------------------------------------------------------------------

describe("the board's rows", () => {
  const DATE = "2026-09-03";
  let db: Awaited<ReturnType<typeof makeTestDb>>["db"];
  let app: ReturnType<typeof createApp>;
  let seventhPlayer: Awaited<ReturnType<typeof newPlayer>>;
  let topPlayer: Awaited<ReturnType<typeof newPlayer>>;
  let soloPlayer: Awaited<ReturnType<typeof newPlayer>>;

  // EXPECTED_ORACLE_TOTAL, by hand, using oracleQuestionPoints on the Oracle's
  // seeded forecast (pYes = 0.6 on every question) against outcome "yes":
  //   brier = (0.6 - 1)^2 = 0.16
  //   base  = POINTS_SCALE * (POINTS_BASELINE - brier) = 200 * (0.25 - 0.16) = 200 * 0.09 = 18
  //   slots 1-4 (not the big one, mult x1): 18 each -> 4 * 18 = 72
  //   slot 5   (the big one,     mult x2): 2 * 18 = 36
  //   total = 72 + 36 = 108
  const EXPECTED_ORACLE_TOTAL = 108;

  // Nine players, distinct raw totals 20 apart so the summit reads 1, 2, 3 and
  // the 7th of 9 is exact: 180 160 140 120 100 80 60 40 20 -> 7th place is 60.
  const TOTALS = [180, 160, 140, 120, 100, 80, 60, 40, 20];

  const boardAs = (p: Awaited<ReturnType<typeof newPlayer>>, date: string) => p.get(`/v1/round/${date}/board`);

  beforeEach(async () => {
    ({ db } = await makeTestDb());
    app = createApp({ db, env });

    // 2026-09-03: the main round -- 9 complete players + the Oracle's forecast.
    const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-02T16:00:00Z"), locksAt: new Date("2026-09-03T16:00:00Z") });
    for (const total of TOTALS) {
      const p = await newPlayer(app);
      await seal(db, p.userId, qs, Array(5).fill(total / 5));
      if (total === 60) seventhPlayer = p;
      if (total === 180) topPlayer = p;
    }
    for (const q of qs) {
      await db.update(schema.questions).set({ oracleProbYes: "0.6" }).where(eq(schema.questions.id, q.id));
    }
    await db.update(schema.questions).set(RESOLVED_ALL).where(eq(schema.questions.roundDate, DATE));

    // 2026-09-04: below the field floor -- only 2 complete players.
    const qs4 = await seedRound(db, { date: "2026-09-04", opensAt: new Date("2026-09-03T16:00:00Z"), locksAt: new Date("2026-09-04T16:00:00Z") });
    soloPlayer = await newPlayer(app);
    await seal(db, soloPlayer.userId, qs4, [10, 10, 10, 10, 10]);
    const other4 = await newPlayer(app);
    await seal(db, other4.userId, qs4, [8, 8, 8, 8, 8]);
    await db.update(schema.questions).set(RESOLVED_ALL).where(eq(schema.questions.roundDate, "2026-09-04"));

    // 2026-09-05: one question left unresolved.
    const qs5 = await seedRound(db, { date: "2026-09-05", opensAt: new Date("2026-09-04T16:00:00Z"), locksAt: new Date("2026-09-05T16:00:00Z") });
    await db.update(schema.questions).set(RESOLVED_ALL).where(and(eq(schema.questions.roundDate, "2026-09-05"), ne(schema.questions.slot, 5)));
  });

  it("returns the summit, the caller's neighbourhood, and the Oracle", async () => {
    // Seed 9 complete players with distinct totals and a forecast on every
    // question, then read the board as the 7th-placed player.
    const res = await boardAs(seventhPlayer, "2026-09-03");
    const body = (await res.json()) as Board;
    expect(res.status).toBe(200);
    const ranks = body.rows.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b)); // non-decreasing
    // NOT asserted unique: rows rank against the PLAYER field, so the Oracle
    // may legitimately share a rank with the player it tied. Seed distinct
    // player totals if you want the summit rows to read 1, 2, 3.
    expect(ranks[0]).toBe(1);
    expect(body.rows.find((r) => r.is_you)!.rank).toBe(body.your_rank);
    expect(body.rows.filter((r) => r.is_oracle)).toHaveLength(1);
  });

  it("pins the Oracle into the window even when it ranks outside it", async () => {
    // Oracle forecasts poorly; it lands mid-field, outside both the summit
    // and the caller's neighbourhood. It must still appear, at its true rank.
    const body = (await (await boardAs(topPlayer, "2026-09-03")).json()) as Board;
    const oracle = body.rows.find((r) => r.is_oracle);
    expect(oracle).toBeDefined();
    expect(oracle!.rank).toBeGreaterThan(CONSTANTS.BOARD_TOP_ROWS);
  });

  it("names players by designation and never by anything they typed", async () => {
    const body = (await (await boardAs(seventhPlayer, "2026-09-03")).json()) as Board;
    for (const row of body.rows) {
      expect(row.name).toBe(row.name.toUpperCase());
      expect(row.name.startsWith("THE ")).toBe(true);
    }
  });

  it("disambiguates a collision inside the rendered window", async () => {
    const body = (await (await boardAs(seventhPlayer, "2026-09-03")).json()) as Board;
    const names = body.rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns no rows below the field floor", async () => {
    const body = (await (await boardAs(soloPlayer, "2026-09-04")).json()) as Board; // 2 complete
    expect(body.rows).toEqual([]);
    expect(body.your_rank).toBeNull();
  });

  it("still 409s until every question carries an outcome", async () => {
    const res = await boardAs(seventhPlayer, "2026-09-05"); // one unresolved
    expect(res.status).toBe(409);
  });

  it("ranks the Oracle on the same ladder as the rows beside it", async () => {
    // The big one's double weight is IN; the contrarian bounty is OUT.
    // Seeded so the Oracle's raw affine-Brier total is known exactly.
    const body = (await (await boardAs(seventhPlayer, "2026-09-03")).json()) as Board;
    const oracle = body.rows.find((r) => r.is_oracle);
    expect(oracle!.points).toBe(EXPECTED_ORACLE_TOTAL);
  });
});

// ---------------------------------------------------------------------------
// The two player-facing surfaces onto the gauntlet (design 2026-09-04 §11):
// what the night's candidates cost, and which locks the probe healed live.
// ---------------------------------------------------------------------------

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
}

/** A round whose every question already carries an outcome, so /:date/reveal 409s otherwise. */
async function seedSettledRound(db: Awaited<ReturnType<typeof makeTestDb>>["db"], date: string) {
  const qs = await seedRound(db, { date, opensAt: new Date(`${date}T00:00:00Z`), locksAt: new Date(`${date}T12:00:00Z`) });
  for (const q of qs) await resolveQuestion(db, q.id, "yes");
  return qs;
}

/** An open round, live right now under a fixed clock -- reset by this file's afterEach. */
async function seedOpenRoundNow(db: Awaited<ReturnType<typeof makeTestDb>>["db"]) {
  vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
  return seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
}

describe("the reveal carries what the gauntlet cost (design 2026-09-04 §11.1)", () => {
  it("reports both counts", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    await seedSettledRound(db, "2026-09-02");
    await db.update(schema.rounds).set({ candidatesWritten: 15, candidatesRejected: 10 }).where(eq(schema.rounds.date, "2026-09-02"));
    const res = await call("/v1/round/2026-09-02/reveal");
    const body = (await res.json()) as { candidates_written: number; candidates_rejected: number };
    expect(body.candidates_written).toBe(15);
    expect(body.candidates_rejected).toBe(10);
  });

  it("reports zero for a round that predates the columns, so the client withholds the line", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    await seedSettledRound(db, "2026-09-02");
    const body = (await (await call("/v1/round/2026-09-02/reveal")).json()) as { candidates_written: number };
    expect(body.candidates_written).toBe(0);
  });
});

describe("/today says which locks were healed (design 2026-09-04 §11.2)", () => {
  it("is false for an ordinary question and for an authored early lock", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    const qs = await seedOpenRoundNow(db);
    // An authored early lock: locked ahead of the round's own last lock at
    // authoring time, status flipped to "locked" -- never touched by the
    // probe, so lockHealedAt stays null. Both an ordinary question elsewhere
    // in the round and this one must read lock_healed: false; a locksAt-only
    // check (rather than lockHealedAt) would wrongly call this one healed.
    await db.update(schema.questions).set({ locksAt: new Date("2026-08-20T18:00:00Z"), status: "locked" }).where(eq(schema.questions.id, qs[0]!.id));
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ lock_healed: boolean }> };
    expect(body.questions.every((q) => q.lock_healed === false)).toBe(true);
  });

  it("is true only for a question the probe closed", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    const qs = await seedOpenRoundNow(db);
    await db.update(schema.questions).set({ lockHealedAt: new Date() }).where(eq(schema.questions.id, qs[0]!.id));
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ id: string; lock_healed: boolean }> };
    expect(body.questions.filter((q) => q.lock_healed).map((q) => q.id)).toEqual([qs[0]!.id]);
  });
  it("reports struck + struck_reason for a withdrawn question, with lock_healed still false", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    const qs = await seedOpenRoundNow(db);
    await withdrawQuestion(db, qs[1]!.id, "misauthored", new Date());
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ id: string; lock_healed: boolean; struck: boolean; struck_reason: string | null }> };
    const w = body.questions.find((q) => q.id === qs[1]!.id)!;
    expect(w.lock_healed).toBe(false);
    expect(w.struck).toBe(true);
    expect(w.struck_reason).toBe(PIPELINE_LINES.withdrawnMisauthored);
    expect(body.questions.filter((q) => q.id !== w.id).every((q) => q.struck === false && q.struck_reason === null)).toBe(true);
  });
  it("reports struck for a probe-healed question too", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    const qs = await seedOpenRoundNow(db);
    await db.update(schema.questions).set({ lockHealedAt: new Date() }).where(eq(schema.questions.id, qs[0]!.id));
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ id: string; struck: boolean }> };
    expect(body.questions.find((q) => q.id === qs[0]!.id)!.struck).toBe(true);
  });
});
