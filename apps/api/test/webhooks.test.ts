import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { eq } from "drizzle-orm";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin", REVENUECAT_WEBHOOK_SECRET: "rc-secret" };

async function setup() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token, user_id } = (await res.json()) as { token: string; user_id: string };
  const deviceId = token.split(".")[0]!;
  const post = (event: Record<string, unknown>, auth = "Bearer rc-secret") =>
    app.request("/v1/webhooks/revenuecat", { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify({ api_version: "1.0", event }) });
  return { db, post, deviceId, userId: user_id };
}
const ent = (db: Awaited<ReturnType<typeof makeTestDb>>["db"], userId: string) =>
  db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, userId) });

describe("POST /v1/webhooks/revenuecat", () => {
  it("401s on a bad secret", async () => {
    const { post, deviceId } = await setup();
    expect((await post({ id: "e1", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_monthly" }, "Bearer wrong")).status).toBe(401);
  });
  it("activates plus on INITIAL_PURCHASE with expiry", async () => {
    const { db, post, deviceId, userId } = await setup();
    const exp = Date.UTC(2026, 9, 1);
    expect((await post({ id: "e1", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: exp })).status).toBe(200);
    const e = await ent(db, userId);
    expect(e?.plusActive).toBe(true);
    expect(e?.expiresAt?.getTime()).toBe(exp);
  });
  it("is idempotent by event id", async () => {
    const { db, post, deviceId, userId } = await setup();
    const evt = { id: "e2", type: "NON_RENEWING_PURCHASE", app_user_id: deviceId, product_id: "shield_rescue" };
    await post(evt); await post(evt);
    expect((await ent(db, userId))?.shieldsRemaining).toBe(1);
  });
  it("adds a shield per distinct rescue purchase", async () => {
    const { db, post, deviceId, userId } = await setup();
    await post({ id: "e3", type: "NON_RENEWING_PURCHASE", app_user_id: deviceId, product_id: "shield_rescue" });
    await post({ id: "e4", type: "NON_RENEWING_PURCHASE", app_user_id: deviceId, product_id: "shield_rescue" });
    expect((await ent(db, userId))?.shieldsRemaining).toBe(2);
  });
  it("deactivates plus on EXPIRATION but keeps bought shields", async () => {
    const { db, post, deviceId, userId } = await setup();
    await post({ id: "e5", type: "NON_RENEWING_PURCHASE", app_user_id: deviceId, product_id: "shield_rescue" });
    await post({ id: "e6", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_annual", expiration_at_ms: Date.UTC(2027, 8, 1) });
    await post({ id: "e7", type: "EXPIRATION", app_user_id: deviceId, product_id: "plus_annual" });
    const e = await ent(db, userId);
    expect(e?.plusActive).toBe(false);
    // 1 (rescue) + 3 (plus INITIAL_PURCHASE grant) = 4; grants survive lapse (spec §2: consumables survive lapse)
    expect(e?.shieldsRemaining).toBe(4);
  });
  it("grants +3 paid shields on INITIAL_PURCHASE of a plus product", async () => {
    const { db, post, deviceId, userId } = await setup();
    await post({ id: "e20", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: Date.UTC(2026, 9, 1) });
    const e = await ent(db, userId);
    expect(e?.plusActive).toBe(true);
    expect(e?.shieldsRemaining).toBe(3);
  });
  it("grants +3 more shields on RENEWAL but caps the total at 5", async () => {
    const { db, post, deviceId, userId } = await setup();
    await post({ id: "e21", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: Date.UTC(2026, 9, 1) });
    await post({ id: "e22", type: "RENEWAL", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: Date.UTC(2026, 10, 1) });
    const e = await ent(db, userId);
    expect(e?.shieldsRemaining).toBe(5); // 3 + 3 = 6, capped at 5
  });
  it("does not grant shields on UNCANCELLATION (no new billing period)", async () => {
    const { db, post, deviceId, userId } = await setup();
    await post({ id: "e23", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: Date.UTC(2026, 9, 1) });
    await post({ id: "e24", type: "UNCANCELLATION", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: Date.UTC(2026, 9, 1) });
    const e = await ent(db, userId);
    expect(e?.shieldsRemaining).toBe(3); // unchanged from the initial grant
  });
  it("RENEWAL extends expiry; CANCELLATION and unknown types are 200 no-ops", async () => {
    const { db, post, deviceId, userId } = await setup();
    await post({ id: "e8", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: Date.UTC(2026, 9, 1) });
    await post({ id: "e9", type: "RENEWAL", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: Date.UTC(2026, 10, 1) });
    expect((await post({ id: "e10", type: "CANCELLATION", app_user_id: deviceId, product_id: "plus_monthly" })).status).toBe(200);
    expect((await post({ id: "e11", type: "SOME_FUTURE_TYPE", app_user_id: deviceId })).status).toBe(200);
    const e = await ent(db, userId);
    expect(e?.plusActive).toBe(true); // cancelled ≠ expired
    expect(e?.expiresAt?.getTime()).toBe(Date.UTC(2026, 10, 1));
  });
  it("preserves the prior expiresAt when a RENEWAL omits expiration_at_ms", async () => {
    const { db, post, deviceId, userId } = await setup();
    const exp = Date.UTC(2026, 9, 1);
    await post({ id: "e25", type: "INITIAL_PURCHASE", app_user_id: deviceId, product_id: "plus_monthly", expiration_at_ms: exp });
    await post({ id: "e26", type: "RENEWAL", app_user_id: deviceId, product_id: "plus_monthly" });
    const e = await ent(db, userId);
    expect(e?.plusActive).toBe(true);
    expect(e?.expiresAt?.getTime()).toBe(exp);
  });
  it("200s (never 4xx) on an unknown app_user_id", async () => {
    const { post } = await setup();
    expect((await post({ id: "e12", type: "INITIAL_PURCHASE", app_user_id: crypto.randomUUID(), product_id: "plus_monthly" })).status).toBe(200);
  });
  it("200s (never 5xx) on a non-UUID app_user_id", async () => {
    const { db, post, userId } = await setup();
    expect((await post({ id: "e13", type: "INITIAL_PURCHASE", app_user_id: "$RCAnonymousID:0123456789abcdef0123456789abcdef", product_id: "plus_monthly" })).status).toBe(200);
    expect(await ent(db, userId)).toBeUndefined(); // no entitlement written
  });
});
