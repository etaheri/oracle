import { describe, it, expect } from "vitest";
import { api, ApiError } from "../src/api/client";
import { getDeviceToken, type TokenStore } from "../src/api/auth";
import { z } from "zod";

const memStore = (): TokenStore => {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
};

describe("api()", () => {
  it("parses a valid response and sends bearer + json headers", async () => {
    let seen: RequestInit | undefined;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const out = await api("/v1/health", z.object({ ok: z.boolean() }), { fetchFn, token: "tok" });
    expect(out).toEqual({ ok: true });
    expect((seen!.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("throws ApiError with status on non-ok", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: "locked" }), { status: 409 })) as typeof fetch;
    await expect(api("/v1/predictions", z.unknown(), { fetchFn, token: "t" })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects when the response fails schema validation", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as typeof fetch;
    await expect(api("/v1/health", z.object({ ok: z.boolean() }), { fetchFn, token: "t" })).rejects.toThrow();
  });
});

describe("getDeviceToken()", () => {
  it("mints once then caches in the store", async () => {
    let mints = 0;
    const fetchFn = (async () => { mints++; return new Response(JSON.stringify({ token: "minted.1.abc", user_id: "u" }), { status: 200 }); }) as typeof fetch;
    const store = memStore();
    expect(await getDeviceToken({ fetchFn, store })).toBe("minted.1.abc");
    expect(await getDeviceToken({ fetchFn, store })).toBe("minted.1.abc");
    expect(mints).toBe(1);
  });
});
