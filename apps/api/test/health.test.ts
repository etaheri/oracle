import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/app";

describe("GET /v1/health", () => {
  it("returns ok", async () => {
    const app = createApp({ db: null as unknown as Db, env: { DEVICE_TOKEN_SECRET: "s", ADMIN_SECRET: "a" } });
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
