import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string) => JSON.stringify({ question_id: q, answer: true, confidence: 85, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("reveal first_hour", () => {
  it("is true only when every one of the round's questions is sealed within the first hour", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });

    const a = await player(app); // all five, all inside the first hour
    for (const q of qs) await a("/v1/predictions", { method: "POST", body: body(q.id) });

    const c = await player(app); // only slot 1, inside the hour
    await c("/v1/predictions", { method: "POST", body: body(qs[0]!.id) });

    const b = await player(app); // four inside the first hour, the fifth after
    for (const q of qs.slice(0, 4)) await b("/v1/predictions", { method: "POST", body: body(q.id) });
    vi.setSystemTime(new Date("2026-08-20T19:00:00Z"));
    await b("/v1/predictions", { method: "POST", body: body(qs[4]!.id) }); // 3h in — not

    for (const q of qs) await resolveQuestion(db, q.id, "yes");

    const ra = (await (await a("/v1/round/2026-08-20/reveal")).json()) as { first_hour: boolean };
    const rb = (await (await b("/v1/round/2026-08-20/reveal")).json()) as { first_hour: boolean };
    const rc = (await (await c("/v1/round/2026-08-20/reveal")).json()) as { first_hour: boolean };
    expect(ra.first_hour).toBe(true);
    expect(rb.first_hour).toBe(false);
    expect(rc.first_hour).toBe(false);
  });
});
