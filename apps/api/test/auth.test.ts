import { describe, it, expect } from "vitest";
import { mintDeviceToken, verifyDeviceToken } from "../src/auth/deviceToken";
import { createApp } from "../src/app";
import { makeTestDb } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

describe("device tokens", () => {
  it("round-trips mint → verify", async () => {
    const t = await mintDeviceToken(env.DEVICE_TOKEN_SECRET, "dev-1", 1755600000000);
    expect(await verifyDeviceToken(env.DEVICE_TOKEN_SECRET, t)).toBe("dev-1");
  });
  it("rejects tampered tokens and wrong secrets", async () => {
    const t = await mintDeviceToken(env.DEVICE_TOKEN_SECRET, "dev-1", 1755600000000);
    expect(await verifyDeviceToken(env.DEVICE_TOKEN_SECRET, t.replace("dev-1", "dev-2"))).toBeNull();
    expect(await verifyDeviceToken("other-secret", t)).toBeNull();
  });
});

describe("POST /v1/auth/device", () => {
  it("creates a user and returns a working bearer token", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await app.request("/v1/auth/device", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "ios" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user_id: string };
    expect(body.token.split(".").length).toBe(3);
    expect(body.user_id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("rejects a bad platform", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await app.request("/v1/auth/device", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "vax" }),
    });
    expect(res.status).toBe(400);
  });
});
