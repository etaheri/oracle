import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
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
const body = (q: string, answer: boolean, confidence = 85) =>
  JSON.stringify({ question_id: q, answer, confidence, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("GET /v1/me/ledger", () => {
  it("computes stats and a tide win from the caller's resolved record", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    // a stands alone on YES; crowd is 1/3 = 33% yes → a's side is 33 (<40)
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await resolveQuestion(db, qs[0]!.id, "yes");

    const res = await a("/v1/me/ledger");
    expect(res.status).toBe(200);
    const out = (await res.json()) as Record<string, unknown>;
    expect(out).toMatchObject({
      days_consulted: 1,
      accuracy_pct: 100,
      avg_confidence: 85,
      tide_wins: 1,
      majority_rate: 0,
      computed_through: "2026-08-20",
    });
    expect((out.epithet as { id: string }).id).toBe("unread"); // < 5 complete rounds

    const resB = await b("/v1/me/ledger");
    const outB = (await resB.json()) as Record<string, unknown>;
    expect(outB).toMatchObject({ accuracy_pct: 0, tide_wins: 0, majority_rate: 1 });
  });

  it("void outcomes are excluded; a fresh player gets the null shape", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) });
    await resolveQuestion(db, qs[1]!.id, "void");

    const out = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ days_consulted: 1, accuracy_pct: null, avg_confidence: null, tide_wins: 0, majority_rate: null });

    const fresh = await player(app);
    const outF = (await (await fresh("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(outF).toMatchObject({ days_consulted: 0, accuracy_pct: null, streak: 0 });
    expect((outF.epithet as { id: string }).id).toBe("unread");
  });

  it("reports shield state: monthly free shield, paid reserve, last hold date", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);

    const fresh = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(fresh).toMatchObject({ free_shield_available: true, paid_shields: 0, shield_used_on: null });

    const uid = (await db.query.users.findMany())[0]!.id;
    await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-19" }).where(eq(schema.users.id, uid));
    await db.insert(schema.entitlements).values({ userId: uid, shieldsRemaining: 2 });

    const spent = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(spent).toMatchObject({ free_shield_available: false, paid_shields: 2, shield_used_on: "2026-08-19" });
  });
});
