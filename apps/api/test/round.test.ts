import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";

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
    }
  });
});
