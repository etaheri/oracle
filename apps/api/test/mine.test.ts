import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("GET /v1/round/today/mine", () => {
  it("returns only the caller's own predictions for the open round", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b] = [await player(app), await player(app)];
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[1]!.id, false) }); // another player — must not leak

    const res = await a("/v1/round/today/mine");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { predictions: Array<{ question_id: string; answer: boolean; confidence: number }> };
    expect(out.predictions).toEqual([{ question_id: qs[0]!.id, answer: true, confidence: 85 }]);
  });

  it("empty when the caller sealed nothing; 404 with no open round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    expect((await a("/v1/round/today/mine")).status).toBe(404);
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await a("/v1/round/today/mine");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { predictions: unknown[] }).predictions).toHaveLength(0);
  });
});
