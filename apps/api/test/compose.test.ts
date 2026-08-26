import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";
import { composeHingePushes } from "../src/push/compose";
import { sendPushes } from "../src/push/onesignal";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

afterEach(() => vi.useRealTimers());

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });

describe("composeHingePushes", () => {
  it("tiers players: results for the sealed, lapsed for the absent; text is slot-free", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) }); // never touches q0; c IS a player
    await resolveQuestion(db, qs[0]!.id, "yes");
    await resolveQuestion(db, qs[1]!.id, "yes");

    const pushes = await composeHingePushes(db, "2026-08-20");
    expect(pushes).toHaveLength(3);
    for (const p of pushes) {
      expect(p.text).not.toMatch(/[{}]/);
      expect(p.lineId.startsWith("noon.")).toBe(true);
      expect(p.lineId.startsWith("noon.lapsed")).toBe(false); // all three played this round
    }
    // a was wrong nowhere (crowd 33% yes, outcome yes): no {n}-line with n=0
    const aPush = pushes.find((p) => p.text.includes("0 OF YOUR"));
    expect(aPush).toBeUndefined();
  });

  it("gives users with no prediction this round the lapsed tier", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await player(app); // registered, never played
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await resolveQuestion(db, qs[0]!.id, "no");

    const pushes = await composeHingePushes(db, "2026-08-20");
    expect(pushes).toHaveLength(2);
    const lapsed = pushes.filter((p) => p.lineId.startsWith("noon.lapsed"));
    expect(lapsed).toHaveLength(1);
  });
});

describe("sendPushes", () => {
  it("no-ops cleanly without OneSignal keys", async () => {
    const out = await sendPushes({}, [{ userId: "u1", text: "THE LEDGER IS READ." }]);
    expect(out).toEqual({ sent: 0, skipped: 1 });
  });

  it("skips the push rather than aborting the batch when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    try {
      const out = await sendPushes({ ONESIGNAL_APP_ID: "app", ONESIGNAL_API_KEY: "key" }, [
        { userId: "u1", text: "THE LEDGER IS READ." },
        { userId: "u2", text: "WHAT WAS SEALED IS NOW SETTLED." },
      ]);
      expect(out).toEqual({ sent: 0, skipped: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
