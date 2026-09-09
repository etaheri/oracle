import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ExhibitionSchema } from "@oracle/core";
import { createApp } from "../src/app";
import { selectExhibition } from "../src/exhibition";
import * as schema from "../src/db/schema";
import { makeTestDb, seedRound } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

async function resolvedRound(db: TestDb, date: string, options: {
  contextAsOf?: string;
  contextText?: string;
  oraclePYes?: number;
  questionText?: string;
  sourceName?: string;
} = {}) {
  const questions = await seedRound(db, {
    date,
    opensAt: new Date(`${date}T16:00:00Z`),
    locksAt: new Date(`${date}T17:00:00Z`),
  });
  await db.update(schema.rounds).set({ status: "scheduled" }).where(eq(schema.rounds.date, date));
  await db.update(schema.questions).set({
    status: "scheduled",
    context: {
      text: options.contextText ?? `Context ${date}`,
      asOf: options.contextAsOf ?? `${date}T15:00:00Z`,
      sourceUrl: "https://example.com/context",
    },
    ...(options.questionText === undefined ? {} : { text: options.questionText }),
    ...(options.sourceName === undefined ? {} : { sourceName: options.sourceName }),
  }).where(eq(schema.questions.roundDate, date));
  const rows = await db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (question, { asc }) => [asc(question.slot)],
  });
  const snapshot = rows.map(({ status: _status, outcome: _outcome, oracleProbYes: _probability, ...question }) => ({
    ...question,
    pYes: options.oraclePYes ?? 0.7,
  }));
  await db.execute(sql`select commit_oracle_forecast(
    ${date}::date, ${JSON.stringify(snapshot)}::jsonb, ${"test-model"},
    ${"forecast-v2"}, ${new Date().toISOString()}::timestamptz
  )`);
  await db.update(schema.rounds).set({ status: "resolved" }).where(eq(schema.rounds.date, date));
  await db.update(schema.questions).set({
    status: "resolved",
    outcome: "yes",
    resolvedAt: new Date(`${date}T18:00:00Z`),
  }).where(eq(schema.questions.roundDate, date));
  return questions;
}

async function uncommittedResolvedRound(db: TestDb, date: string) {
  const questions = await seedRound(db, {
    date,
    opensAt: new Date(`${date}T16:00:00Z`),
    locksAt: new Date(`${date}T17:00:00Z`),
  });
  await db.update(schema.rounds).set({ status: "resolved" }).where(eq(schema.rounds.date, date));
  await db.update(schema.questions).set({
    status: "resolved",
    outcome: "yes",
    context: { text: `Context ${date}`, asOf: `${date}T15:00:00Z`, sourceUrl: "https://example.com/context" },
    oracleProbYes: "0.7",
  }).where(eq(schema.questions.roundDate, date));
  return questions;
}

async function authed() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const mint = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = await mint.json() as { token: string };
  return {
    app,
    db,
    get: () => app.request("/v1/round/exhibition", { headers: { authorization: `Bearer ${token}` } }),
  };
}

describe("selectExhibition", () => {
  let db: TestDb;

  beforeEach(async () => {
    ({ db } = await makeTestDb());
  });

  it("returns the first slot from the newest fully resolved eligible round", async () => {
    await resolvedRound(db, "2099-08-19");
    const newest = await resolvedRound(db, "2099-08-20");
    const selected = await selectExhibition(db);
    expect(selected).toEqual({
      id: newest[0]!.id,
      kind: "historical",
      question: "Question 1?",
      context: "Context 2099-08-20",
      sourceName: "test",
      roundDate: "2099-08-20",
      oraclePYes: 0.7,
      outcome: "yes",
    });
    expect(ExhibitionSchema.parse(selected)).toEqual(selected);
  });

  it("skips an ineligible newest question and chooses the next deterministic candidate", async () => {
    const questions = await resolvedRound(db, "2099-08-20");
    await db.update(schema.questions).set({ lockHealedAt: new Date("2099-08-20T16:30:00Z") }).where(eq(schema.questions.id, questions[0]!.id));
    expect((await selectExhibition(db))?.id).toBe(questions[1]!.id);
  });

  it("never exhibits a withdrawn question", async () => {
    const questions = await resolvedRound(db, "2099-08-20");
    await db.update(schema.questions).set({ withdrawnAt: new Date("2099-08-20T16:30:00Z") }).where(eq(schema.questions.id, questions[0]!.id));
    expect((await selectExhibition(db))?.id).toBe(questions[1]!.id);
  });

  it("excludes pending, live, void, malformed-context, and missing-forecast records while accepting 0.5", async () => {
    await seedRound(db, { date: "2099-08-24", opensAt: new Date("2099-08-24T16:00:00Z"), locksAt: new Date("2099-08-25T16:00:00Z") });
    const voided = await resolvedRound(db, "2099-08-23");
    await db.update(schema.questions).set({ status: "void", outcome: "void" }).where(eq(schema.questions.id, voided[0]!.id));
    const malformed = await resolvedRound(db, "2099-08-22", { contextText: "" });
    const eligible = await resolvedRound(db, "2099-08-21", { oraclePYes: 0.5 });
    await db.update(schema.questions).set({ outcome: "no" }).where(eq(schema.questions.id, eligible[0]!.id));
    const selected = await selectExhibition(db);
    expect(selected?.id).toBe(voided[1]!.id);
    await db.update(schema.questions).set({ lockHealedAt: new Date() }).where(eq(schema.questions.roundDate, "2099-08-23"));
    await db.update(schema.questions).set({ lockHealedAt: new Date() }).where(eq(schema.questions.roundDate, "2099-08-22"));
    expect(await selectExhibition(db)).toMatchObject({ id: eligible[0]!.id, oraclePYes: 0.5, outcome: "no" });
  });

  it("requires a pre-opening commitment and pre-opening context", async () => {
    const missingCommitment = await uncommittedResolvedRound(db, "2099-08-26");
    const lateContext = await resolvedRound(db, "2099-08-25", { contextAsOf: "2099-08-25T16:01:00Z" });
    expect(missingCommitment).toHaveLength(5);
    expect(lateContext).toHaveLength(5);
    expect(await selectExhibition(db)).toBeNull();
  });

  it("rejects whitespace question and source strings", async () => {
    await resolvedRound(db, "2099-08-27", { questionText: "   ", sourceName: "\t" });
    expect(await selectExhibition(db)).toBeNull();
  });

  it("looks only within the newest 30 resolved rounds", async () => {
    for (let day = 1; day <= 31; day += 1) {
      const date = `2099-07-${String(day).padStart(2, "0")}`;
      const questions = await resolvedRound(db, date, day > 1 ? { contextAsOf: `${date}T16:01:00Z` } : {});
      if (day > 1) {
        expect((await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) })).every((question) => question.context !== null)).toBe(true);
      }
      else expect(questions).toHaveLength(5);
    }
    expect(await selectExhibition(db)).toBeNull();
  });
});

describe("GET /v1/round/exhibition", () => {
  it("requires device authentication and returns 404 for an empty database", async () => {
    const { app, get } = await authed();
    expect((await app.request("/v1/round/exhibition")).status).toBe(401);
    expect((await get()).status).toBe(404);
  });

  it("returns validated public history without mutating predictions or the user ledger", async () => {
    const { db, get } = await authed();
    await resolvedRound(db, "2099-08-20");
    const beforePredictions = await db.select({ n: count() }).from(schema.predictions);
    const beforeUsers = await db.select().from(schema.users);
    const response = await get();
    expect(response.status).toBe(200);
    expect(ExhibitionSchema.parse(await response.json())).toMatchObject({ kind: "historical", roundDate: "2099-08-20" });
    expect(await db.select({ n: count() }).from(schema.predictions)).toEqual(beforePredictions);
    expect(await db.select().from(schema.users)).toEqual(beforeUsers);
  });
});
