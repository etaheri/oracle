import { describe, it, expect, vi, afterEach } from "vitest";
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
});
