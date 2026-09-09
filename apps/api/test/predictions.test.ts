import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function setup(opts?: { opensAt?: Date; locksAt?: Date }) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = (await res.json()) as { token: string };
  const qs = await seedRound(db, {
    date: "2026-08-20",
    opensAt: opts?.opensAt ?? new Date("2026-08-20T16:00:00Z"),
    locksAt: opts?.locksAt ?? new Date("2026-08-21T16:00:00Z"),
  });
  const submit = (body: object) =>
    app.request("/v1/predictions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  return { db, qs, submit };
}

const body = (questionId: string) => ({ question_id: questionId, answer: true, confidence: 75, idempotency_key: "k1" });

afterEach(() => vi.useRealTimers());

describe("POST /v1/predictions", () => {
  it("rejects a known question ID before its opening", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T15:59:59Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup();
    expect((await submit(body(qs[0]!.id))).status).toBe(409);
    expect(await db.query.predictions.findMany()).toHaveLength(0);
  });
  it("rejects scheduled questions even after their nominal opening", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup();
    await db.update(schema.questions).set({ status: "scheduled" }).where(eq(schema.questions.id, qs[0]!.id));
    expect((await submit(body(qs[0]!.id))).status).toBe(409);
    expect(await db.query.predictions.findMany()).toHaveLength(0);
  });
  it("rejects questions in a round that is not published yet", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup();
    await db.update(schema.rounds).set({ status: "scheduled" }).where(eq(schema.rounds.date, "2026-08-20"));
    expect((await submit(body(qs[0]!.id))).status).toBe(409);
    expect(await db.query.predictions.findMany()).toHaveLength(0);
  });
  it("inserts and flags first hour", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { qs, submit } = await setup();
    const res = await submit(body(qs[0]!.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { first_hour: boolean }).first_hour).toBe(true);
  });
  it("is idempotent on resubmission", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T18:00:00Z"), toFake: ["Date"] });
    const { qs, submit } = await setup();
    const first = (await (await submit(body(qs[0]!.id))).json()) as { id: string; first_hour: boolean };
    expect(first.first_hour).toBe(false);
    const res2 = await submit({ ...body(qs[0]!.id), answer: false, confidence: 95 });
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as { id: string }).id).toBe(first.id); // original stands; no edits after submit
  });
  it("409s after lock", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-21T16:00:01Z"), toFake: ["Date"] });
    const { qs, submit } = await setup();
    expect((await submit(body(qs[0]!.id))).status).toBe(409);
  });
  it("404s on unknown question, 400s on bad confidence", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { qs, submit } = await setup();
    expect((await submit(body("3f0d8c1e-2b4a-4c6d-9e8f-1a2b3c4d5e6f"))).status).toBe(404);
    expect((await submit({ ...body(qs[0]!.id), confidence: 72 })).status).toBe(400);
  });

  it("snapshots the crowd at the instant of the seal, including the sealer (design 2026-09-09 §4.1)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db, qs } = await setup();
    const app = createApp({ db, env });
    const mint = async () => {
      const res = await app.request("/v1/auth/device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "ios" }),
      });
      const { token } = (await res.json()) as { token: string };
      return (b: object) =>
        app.request("/v1/predictions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(b),
        });
    };
    const [submitA, submitB, submitC] = [await mint(), await mint(), await mint()];

    const resA = await submitA({ question_id: qs[0]!.id, answer: true, confidence: 75, idempotency_key: "a" });
    const { id: idA } = (await resA.json()) as { id: string };
    const rowA = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, idA) });
    expect(rowA?.crowdYesPctAtSeal).toBe("100");
    expect(rowA?.crowdCountAtSeal).toBe(1);

    const resB = await submitB({ question_id: qs[0]!.id, answer: false, confidence: 75, idempotency_key: "b" });
    const { id: idB } = (await resB.json()) as { id: string };
    const rowB = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, idB) });
    expect(rowB?.crowdYesPctAtSeal).toBe("50");
    expect(rowB?.crowdCountAtSeal).toBe(2);

    const resC = await submitC({ question_id: qs[0]!.id, answer: true, confidence: 75, idempotency_key: "c" });
    const { id: idC } = (await resC.json()) as { id: string };
    const rowC = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, idC) });
    expect(rowC?.crowdYesPctAtSeal).toBe("67");
    expect(rowC?.crowdCountAtSeal).toBe(3);
  });

  it("does not rewrite the snapshot on a duplicate seal", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db, qs } = await setup();
    const app = createApp({ db, env });
    const mint = async () => {
      const res = await app.request("/v1/auth/device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "ios" }),
      });
      const { token } = (await res.json()) as { token: string };
      return (b: object) =>
        app.request("/v1/predictions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(b),
        });
    };
    const [submitA, submitB] = [await mint(), await mint()];

    const resA = await submitA({ question_id: qs[0]!.id, answer: true, confidence: 75, idempotency_key: "a" });
    const { id: idA } = (await resA.json()) as { id: string };
    await submitB({ question_id: qs[0]!.id, answer: false, confidence: 75, idempotency_key: "b" });
    // A seals again (duplicate) -- must not rewrite A's snapshot even though
    // the crowd has grown since A's original seal.
    await submitA({ question_id: qs[0]!.id, answer: false, confidence: 95, idempotency_key: "a2" });

    const rowA = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, idA) });
    expect(rowA?.crowdYesPctAtSeal).toBe("100");
    expect(rowA?.crowdCountAtSeal).toBe(1);
  });

  it("still returns 200 with an id when the crowd snapshot write fails -- a failed snapshot must never fail a seal", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup();
    // Player A seals normally, before the spy is installed -- the snapshot
    // write succeeds and this row is unaffected by the failure below.
    await submit(body(qs[0]!.id));

    const app2 = createApp({ db, env });
    const res2 = await app2.request("/v1/auth/device", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "ios" }),
    });
    const { token: tokenB } = (await res2.json()) as { token: string };
    const submitB = (b: object) =>
      app2.request("/v1/predictions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokenB}` },
        body: JSON.stringify(b),
      });

    // Force the snapshot's UPDATE to throw once, simulating a DB hiccup after
    // player B's row has already landed durably.
    const updateSpy = vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("simulated DB failure");
    });
    const resB = await submitB({ question_id: qs[0]!.id, answer: false, confidence: 75, idempotency_key: "b" });
    expect(resB.status).toBe(200);
    const { id: idB } = (await resB.json()) as { id: string };
    expect(idB).toBeTruthy();
    updateSpy.mockRestore();

    // The row landed (this IS the seal), but its snapshot stayed null --
    // honest about what failed, rather than lying about the seal itself.
    const rowB = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, idB) });
    expect(rowB).toBeTruthy();
    expect(rowB?.crowdCountAtSeal).toBeNull();
    expect(rowB?.crowdYesPctAtSeal).toBeNull();
  });
});
