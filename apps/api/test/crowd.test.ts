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
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 75, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("GET /v1/round/today/crowd", () => {
  it("returns crowd % only for questions the caller sealed", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await b("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) }); // a did NOT seal q2

    const res = await a("/v1/round/today/crowd");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { questions: Array<{ id: string; crowd_yes_pct: number; player_count: number }> };
    expect(out.questions).toHaveLength(1); // only q1 — a hasn't sealed q2
    expect(out.questions[0]).toEqual({ id: qs[0]!.id, crowd_yes_pct: 33, player_count: 3 });
  });
  it("empty list when the caller sealed nothing; 404 with no open round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    expect((await a("/v1/round/today/crowd")).status).toBe(404);
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await a("/v1/round/today/crowd");
    expect(((await res.json()) as { questions: unknown[] }).questions).toHaveLength(0);
  });
});
