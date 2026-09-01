import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { eq } from "drizzle-orm";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin", APPLE_BUNDLE_ID: "com.erikcitrine.oracle" };
// Injected verifier: token string IS the sub, "bad" fails — endpoint logic under test, not JWT crypto (Task 4 owns that).
const verifyApple = async (token: string) => (token === "bad" ? null : { sub: token });

async function mint(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token, user_id } = (await res.json()) as { token: string; user_id: string };
  const call = (path: string, body: Record<string, unknown>) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { token, userId: user_id, call };
}

describe("apple identity", () => {
  it("claims an unbound sub onto the caller's user", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env, verifyApple });
    const a = await mint(app);
    expect((await a.call("/v1/auth/apple/claim", { identity_token: "sub-A" })).status).toBe(200);
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, a.userId) });
    expect(u?.appleSub).toBe("sub-A");
  });
  it("claim is idempotent for the same user, 409 for another user's sub; 401 on bad token", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env, verifyApple });
    const a = await mint(app); const b = await mint(app);
    await a.call("/v1/auth/apple/claim", { identity_token: "sub-A" });
    expect((await a.call("/v1/auth/apple/claim", { identity_token: "sub-A" })).status).toBe(200);
    expect((await b.call("/v1/auth/apple/claim", { identity_token: "sub-A" })).status).toBe(409);
    expect((await b.call("/v1/auth/apple/claim", { identity_token: "bad" })).status).toBe(401);
  });
  it("restore re-points the calling device at the claimed record", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env, verifyApple });
    const old = await mint(app);
    await old.call("/v1/auth/apple/claim", { identity_token: "sub-A" });
    const fresh = await mint(app); // new phone
    const res = await fresh.call("/v1/auth/apple/restore", { identity_token: "sub-A" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user_id: string }).user_id).toBe(old.userId);
    // fresh device now acts as the old user:
    const me = await app.request("/v1/me/ledger", { headers: { authorization: `Bearer ${fresh.token}` } });
    expect(me.status).toBe(200);
    expect((await fresh.call("/v1/auth/apple/restore", { identity_token: "sub-NOBODY" })).status).toBe(404);
  });
  it("strike deletes the record — predictions, entitlements, devices, user", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env, verifyApple });
    const a = await mint(app);
    await db.insert(schema.entitlements).values({ userId: a.userId, shieldsRemaining: 2 });
    expect((await a.call("/v1/auth/apple/strike", {})).status).toBe(200);
    expect(await db.query.users.findFirst({ where: eq(schema.users.id, a.userId) })).toBeUndefined();
    // the device token is dead:
    expect((await a.call("/v1/auth/apple/claim", { identity_token: "sub-Z" })).status).toBe(401);
  });
});
