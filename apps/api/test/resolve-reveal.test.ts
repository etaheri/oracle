import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin-secret" };

async function playerOn(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}

afterEach(() => vi.useRealTimers());

describe("resolve + reveal cycle", () => {
  it("grades predictions with contrarian crowd math and reveals them", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const q1 = qs[0]!.id;

    // three players: A yes@75 (first hour), B no@55, C no@55 → crowd 33% YES, A is contrarian
    const [a, b, cPlayer] = [await playerOn(app), await playerOn(app), await playerOn(app)];
    await a("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: q1, answer: true, confidence: 75, idempotency_key: "a" }) });
    await b("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: q1, answer: false, confidence: 55, idempotency_key: "b" }) });
    await cPlayer("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: q1, answer: false, confidence: 55, idempotency_key: "c" }) });

    // lock all questions, resolve q1 YES
    vi.setSystemTime(new Date("2026-08-21T16:05:00Z"));
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-20"));
    const resolveRes = await app.request(`/admin/questions/${q1}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": env.ADMIN_SECRET },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(resolveRes.status).toBe(200);

    const reveal = await a("/v1/round/2026-08-20/reveal");
    expect(reveal.status).toBe(200);
    const bodyJson = (await reveal.json()) as {
      day_points: number;
      questions: Array<{ id: string; outcome: string | null; crowd_yes_pct: number | null; my: { points: number | null } | null }>;
    };
    const rq = bodyJson.questions.find((x) => x.id === q1)!;
    expect(rq.outcome).toBe("yes");
    expect(rq.crowd_yes_pct).toBe(33);
    // A: correct @75 → base 37.5, contrarian ×2 (33% < 40) → round(75) = 75; first hour: +round(7.5)=8 → day 83
    expect(rq.my!.points).toBe(75);
    expect(bodyJson.day_points).toBe(83);
  });

  it("rejects reveal while any question is still open, and admin without secret", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await playerOn(app);
    expect((await a("/v1/round/2026-08-20/reveal")).status).toBe(409);
    const res = await app.request(`/admin/questions/${qs[0]!.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(res.status).toBe(401);
  });

  it("void questions grade to 0 points and null brier", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await playerOn(app);
    await a("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qs[0]!.id, answer: true, confidence: 95, idempotency_key: "a" }) });
    vi.setSystemTime(new Date("2026-08-21T16:05:00Z"));
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-20"));
    await app.request(`/admin/questions/${qs[0]!.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": env.ADMIN_SECRET },
      body: JSON.stringify({ outcome: "void" }),
    });
    const pred = await db.query.predictions.findFirst();
    expect(pred!.points).toBe(0);
    expect(pred!.brier).toBeNull();
  });
});
