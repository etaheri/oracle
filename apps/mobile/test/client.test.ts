import { describe, it, expect } from "vitest";
import { api } from "../src/api/client";
import { getDeviceToken, clearDeviceToken, type TokenStore } from "../src/api/auth";
import { z } from "zod";

const memStore = (): TokenStore => {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
  };
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
  it("throws ApiError with status on a non-JSON body", async () => {
    const fetchFn = (async () => new Response("not json", { status: 200 })) as typeof fetch;
    await expect(api("/v1/health", z.object({ ok: z.boolean() }), { fetchFn, token: "t" })).rejects.toMatchObject({
      status: 200,
      name: "ApiError",
    });
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
  it("concurrent callers share one mint — never a user per query", async () => {
    let mints = 0;
    const fetchFn = (async () => {
      mints++;
      await new Promise((r) => setTimeout(r, 20)); // hold the mint in flight
      return new Response(JSON.stringify({ token: `minted.${mints}.abc`, user_id: "u" }), { status: 200 });
    }) as typeof fetch;
    const store = memStore();
    const [a, b, c] = await Promise.all([
      getDeviceToken({ fetchFn, store }),
      getDeviceToken({ fetchFn, store }),
      getDeviceToken({ fetchFn, store }),
    ]);
    expect(mints).toBe(1);
    expect(a).toBe("minted.1.abc");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe("clearDeviceToken()", () => {
  it("removes the stored token so the next getDeviceToken mints fresh", async () => {
    const store = memStore();
    let mints = 0;
    const fetchFn = (async () => { mints++; return new Response(JSON.stringify({ token: `minted.${mints}.abc`, user_id: "u" }), { status: 200 }); }) as typeof fetch;
    await getDeviceToken({ fetchFn, store });
    await clearDeviceToken({ store });
    await getDeviceToken({ fetchFn, store });
    expect(mints).toBe(2);
  });
});

// The dead-install bug: SecureStore is the iOS Keychain, which survives app
// deletion, so a token whose server row is gone cannot be cleared by
// reinstalling and every authed call 401s forever. These hold the way out.
describe("recovering from a 401 on a token we believed in", () => {
  const okAfter = (deadToken: string) => {
    const calls: Array<{ auth: string | undefined; url: string }> = [];
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      calls.push({ auth, url: String(url) });
      if (String(url).endsWith("/v1/auth/device")) {
        return new Response(JSON.stringify({ token: "fresh", user_id: "u2" }), { status: 200 });
      }
      return auth === `Bearer ${deadToken}`
        ? new Response("", { status: 401 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    return { fetchFn, calls };
  };

  it("mints a new device and retries once, instead of 401ing forever", async () => {
    const store = memStore();
    await store.set("oracle.device_token", "dead");
    const { fetchFn, calls } = okAfter("dead");
    const { recoverFromUnauthorized } = await import("../src/api/auth");
    const { setUnauthorizedRecovery } = await import("../src/api/client");
    setUnauthorizedRecovery((stale) => recoverFromUnauthorized(stale, { store, fetchFn }));

    const out = await api("/v1/round/today", z.object({ ok: z.boolean() }), { fetchFn, token: "dead" });
    expect(out).toEqual({ ok: true });
    expect(await store.get("oracle.device_token")).toBe("fresh");
    expect(calls.filter((c) => c.url.endsWith("/v1/auth/device"))).toHaveLength(1);
  });

  it("retries exactly once — a server that 401s everything must not loop", async () => {
    const store = memStore();
    await store.set("oracle.device_token", "dead");
    let mints = 0;
    const fetchFn = (async (url: unknown) => {
      if (String(url).endsWith("/v1/auth/device")) {
        mints++;
        return new Response(JSON.stringify({ token: `fresh${mints}`, user_id: "u" }), { status: 200 });
      }
      return new Response("", { status: 401 });
    }) as typeof fetch;
    const { recoverFromUnauthorized } = await import("../src/api/auth");
    const { setUnauthorizedRecovery } = await import("../src/api/client");
    setUnauthorizedRecovery((stale) => recoverFromUnauthorized(stale, { store, fetchFn }));

    await expect(api("/v1/round/today", z.unknown(), { fetchFn, token: "dead" })).rejects.toMatchObject({ status: 401 });
    expect(mints).toBe(1);
  });

  it("a burst of 401s mints ONE new device, not one per query", async () => {
    // First launch fires several authed queries at once and they all 401
    // together. Whoever recovers first wins; the rest must take the token
    // that arrived rather than deleting it and starting another user.
    const store = memStore();
    await store.set("oracle.device_token", "dead");
    const { fetchFn, calls } = okAfter("dead");
    const { recoverFromUnauthorized } = await import("../src/api/auth");
    const { setUnauthorizedRecovery } = await import("../src/api/client");
    setUnauthorizedRecovery((stale) => recoverFromUnauthorized(stale, { store, fetchFn }));

    await Promise.all(
      ["/v1/round/today", "/v1/me/ledger", "/v1/round/next", "/v1/round/today/crowd"].map((p) =>
        api(p, z.object({ ok: z.boolean() }), { fetchFn, token: "dead" }),
      ),
    );
    expect(calls.filter((c) => c.url.endsWith("/v1/auth/device"))).toHaveLength(1);
    expect(await store.get("oracle.device_token")).toBe("fresh");
  });

  it("a late recovery takes the token that arrived, instead of starting a second user", async () => {
    // The burst test above does NOT cover this: getDeviceToken's own
    // inflightMint already collapses simultaneous mints, so it passes with or
    // without the guard (verified by deleting the guard and re-running it).
    // The case the guard is actually for is SEQUENTIAL — one query recovers
    // and stores a fresh token, and a slower query that 401'd on the same dead
    // token only reaches recovery afterwards. Unguarded, it deletes the good
    // token and mints again, quietly abandoning the record that was just made.
    const store = memStore();
    await store.set("oracle.device_token", "dead");
    let mints = 0;
    const fetchFn = (async (url: unknown) => {
      if (String(url).endsWith("/v1/auth/device")) {
        mints++;
        return new Response(JSON.stringify({ token: `fresh${mints}`, user_id: `u${mints}` }), { status: 200 });
      }
      return new Response("", { status: 401 });
    }) as typeof fetch;
    const { recoverFromUnauthorized } = await import("../src/api/auth");

    expect(await recoverFromUnauthorized("dead", { store, fetchFn })).toBe("fresh1");
    expect(await recoverFromUnauthorized("dead", { store, fetchFn })).toBe("fresh1");
    expect(mints).toBe(1);
    expect(await store.get("oracle.device_token")).toBe("fresh1");
  });

  it("never mints for an unauthenticated 401 — that is a different bug", async () => {
    const store = memStore();
    let mints = 0;
    const fetchFn = (async (url: unknown) => {
      if (String(url).endsWith("/v1/auth/device")) { mints++; return new Response(JSON.stringify({ token: "x", user_id: "u" }), { status: 200 }); }
      return new Response("", { status: 401 });
    }) as typeof fetch;
    const { recoverFromUnauthorized } = await import("../src/api/auth");
    const { setUnauthorizedRecovery } = await import("../src/api/client");
    setUnauthorizedRecovery((stale) => recoverFromUnauthorized(stale, { store, fetchFn }));

    await expect(api("/v1/auth/apple/claim", z.unknown(), { fetchFn })).rejects.toMatchObject({ status: 401 });
    expect(mints).toBe(0);
  });

  it("lets the original 401 stand when the mint itself fails", async () => {
    const store = memStore();
    await store.set("oracle.device_token", "dead");
    const fetchFn = (async (url: unknown) => {
      if (String(url).endsWith("/v1/auth/device")) return new Response("", { status: 503 });
      return new Response("", { status: 401 });
    }) as typeof fetch;
    const { recoverFromUnauthorized } = await import("../src/api/auth");
    const { setUnauthorizedRecovery } = await import("../src/api/client");
    setUnauthorizedRecovery((stale) => recoverFromUnauthorized(stale, { store, fetchFn }));

    await expect(api("/v1/round/today", z.unknown(), { fetchFn, token: "dead" })).rejects.toMatchObject({ status: 401 });
  });
});
