# Revenue Rites (Plan 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship RevenueCat-powered Oracle Plus (shields + rescue IAP), a deployed OneSignal campaign, Sign in with Apple claim/restore/strike, PostHog/Sentry, and the EAS dev-client path to App Review.

**Architecture:** "Store rails, custom chrome" — RevenueCat Offerings drive a custom in-brand paywall (no `purchases-ui`); a Worker webhook writes the existing `entitlements` table; SIWA is a claim on the existing device-token identity (device token stays the only session credential); OneSignal's award requirement is met by a dashboard lifecycle campaign, never the unwired hinge push.

**Tech Stack:** Hono/Workers + Drizzle/Neon (PGlite in tests), Expo SDK 57 dev client, `react-native-purchases`, `react-native-onesignal`, `expo-apple-authentication`, `posthog-react-native`, `@sentry/react-native`.

**Spec:** `docs/superpowers/specs/2026-08-31-plan-3b-revenue-rites-design.md` — read it first; §0 decisions are binding.

## Global Constraints

- Branch: work continues on `gameplay-audit-fixes` (spec §7 branch ruling; merging to main is Erik's call).
- Pricing: `plus_monthly` $2.99 / `plus_annual` $19.99 / `shield_rescue` $1.99. Entitlement id `plus`. Offering id `default`.
- Identity: RevenueCat app user ID = device ID; OneSignal external user ID = device ID. Never `Purchases.logIn` aliasing.
- Machine voice: all new player-facing copy in `packages/core/src/copy.ts` under the lint (`packages/core/test/copy-lint.test.ts`). ALL CAPS, no emoji, no `!`, ≤140 chars. Purchase CTAs live in `PAYWALL_CTA_LINES` (own const, own mini-lint) — never inside `COPY_BANK`.
- neon-http has no transactions: idempotency via marker rows (`webhook_events`), player-favorable write ordering.
- Mobile testing convention: pure logic in `apps/mobile/src/game/*` or `src/monetization/*pure*` with node tests in `apps/mobile/test/`; RN-importing modules verified by typecheck + manual dev-client pass.
- API tests touching open rounds freeze time: `vi.useFakeTimers({ now: ..., toFake: ["Date"] })` + `afterEach(() => vi.useRealTimers())`.
- Expo APIs: read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing Expo-API code.
- Native SDKs must degrade: missing `EXPO_PUBLIC_*` keys → no-op/mock mode, app still runs in the simulator.
- Test commands: `pnpm --filter @oracle/api test`, `--filter @oracle/core test`, `--filter @oracle/mobile test`; typecheck same filters.
- Commit after every task, conventional prefixes.
- ⛔ **GATED (ERIK)** tasks need accounts/keys Erik must create (spec §9). Code tasks never block on them.

---

### Task 1: Schema — `apple_sub`, drop `clerk_id`, `webhook_events`

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0004_*.sql` (via `pnpm --filter @oracle/api db:generate`)
- Test: `apps/api/test/schema.test.ts` (extend)

**Interfaces:**
- Produces: `users.appleSub: text unique nullable`; `webhookEvents` table (`id text PK`, `receivedAt timestamptz default now`). `users.clerkId` GONE — grep confirms nothing reads it before dropping.

- [ ] **Step 1: Write the failing test** — extend `apps/api/test/schema.test.ts`:

```ts
it("stores apple_sub uniquely and webhook event markers", async () => {
  const { db } = await makeTestDb();
  const [u1] = await db.insert(schema.users).values({ appleSub: "sub-1" }).returning();
  await expect(db.insert(schema.users).values({ appleSub: "sub-1" })).rejects.toThrow();
  expect(u1!.appleSub).toBe("sub-1");
  await db.insert(schema.webhookEvents).values({ id: "evt-1" });
  const dup = await db.insert(schema.webhookEvents).values({ id: "evt-1" }).onConflictDoNothing().returning();
  expect(dup).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @oracle/api test -- schema` → FAIL (`appleSub` not a column).
- [ ] **Step 3: Implement** — in `schema.ts`: replace `clerkId: text("clerk_id").unique(),` on `users` with `appleSub: text("apple_sub").unique(),`. First run `grep -rn "clerkId\|clerk_id" apps/ packages/` — expect only schema.ts; if anything else reads it, stop and report. Add:

```ts
// Processed RevenueCat webhook event ids — the webhook's idempotency marker
// (neon-http has no transactions; insert-first, conflict = already handled).
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Generate migration** — `pnpm --filter @oracle/api db:generate`. Inspect the SQL: expect `ALTER TABLE users DROP COLUMN clerk_id`, `ADD COLUMN apple_sub text UNIQUE`, `CREATE TABLE webhook_events`. (Dev Neon gets it by hand via psql later — existing convention; note it in the commit body.)
- [ ] **Step 5: Run tests** — `pnpm --filter @oracle/api test` → all green. Typecheck.
- [ ] **Step 6: Commit** — `git add -A apps/api && git commit -m "feat(api): apple_sub identity column, webhook_events idempotency table, clerk_id retired"`

---

### Task 2: RevenueCat webhook → entitlements

**Files:**
- Create: `apps/api/src/routes/webhooks.ts`
- Modify: `apps/api/src/app.ts` (mount + env), `apps/api/src/routes/auth.ts` is NOT touched
- Test: `apps/api/test/webhooks.test.ts`

**Interfaces:**
- Consumes: Task 1's `webhookEvents`; existing `devices`/`entitlements` tables.
- Produces: `POST /v1/webhooks/revenuecat` (Bearer `REVENUECAT_WEBHOOK_SECRET`); `AppEnv` gains `REVENUECAT_WEBHOOK_SECRET?: string`. Event semantics for Task 12's dashboard config.

- [ ] **Step 1: Write the failing tests** — `apps/api/test/webhooks.test.ts`:

```ts
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
    expect(e?.shieldsRemaining).toBe(1); // spec §2: consumables survive lapse
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
  it("200s (never 4xx) on an unknown app_user_id", async () => {
    const { post } = await setup();
    expect((await post({ id: "e12", type: "INITIAL_PURCHASE", app_user_id: crypto.randomUUID(), product_id: "plus_monthly" })).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — route doesn't exist (404s → status assertions fail).
- [ ] **Step 3: Implement** — `apps/api/src/routes/webhooks.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import type { AppContext } from "../app";
import { schema } from "../db/client";

// RevenueCat webhook (spec §2). Idempotent via webhook_events insert-first.
// Ruling: always 200 for payloads we can't act on — RevenueCat retries 4xx/5xx
// and a permanently-bad event would retry forever. 401 only for a bad secret.
const EventSchema = z.object({
  id: z.string(),
  type: z.string(),
  app_user_id: z.string(),
  product_id: z.string().optional(),
  expiration_at_ms: z.number().optional(),
});
const PLUS_PRODUCTS = ["plus_monthly", "plus_annual"];
const ACTIVATING = ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"];

export const webhookRoutes = new Hono<AppContext>().post("/revenuecat", async (c) => {
  const { db, env } = c.get("deps");
  const secret = env.REVENUECAT_WEBHOOK_SECRET;
  const auth = c.req.header("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = EventSchema.safeParse((body as { event?: unknown } | null)?.event);
  if (!parsed.success) return c.json({ ok: true, ignored: "malformed" });
  const evt = parsed.data;

  const marker = await db.insert(schema.webhookEvents).values({ id: evt.id }).onConflictDoNothing().returning();
  if (marker.length === 0) return c.json({ ok: true, ignored: "duplicate" });

  const device = await db.query.devices.findFirst({ where: eq(schema.devices.id, evt.app_user_id) });
  if (!device) return c.json({ ok: true, ignored: "unknown app_user_id" });
  const userId = device.userId;

  const ensure = () => db.insert(schema.entitlements).values({ userId }).onConflictDoNothing();

  if (evt.type === "NON_RENEWING_PURCHASE" && evt.product_id === "shield_rescue") {
    await ensure();
    await db.update(schema.entitlements)
      .set({ shieldsRemaining: sql`${schema.entitlements.shieldsRemaining} + 1`, updatedAt: new Date() })
      .where(eq(schema.entitlements.userId, userId));
    return c.json({ ok: true });
  }
  if (evt.product_id && PLUS_PRODUCTS.includes(evt.product_id)) {
    if (ACTIVATING.includes(evt.type)) {
      await ensure();
      await db.update(schema.entitlements)
        .set({ plusActive: true, expiresAt: evt.expiration_at_ms ? new Date(evt.expiration_at_ms) : null, updatedAt: new Date() })
        .where(eq(schema.entitlements.userId, userId));
    } else if (evt.type === "EXPIRATION") {
      await ensure();
      await db.update(schema.entitlements)
        .set({ plusActive: false, updatedAt: new Date() })
        .where(eq(schema.entitlements.userId, userId));
    }
    // CANCELLATION = auto-renew off, entitlement holds until EXPIRATION. BILLING_ISSUE: grace handled by eventual EXPIRATION.
  }
  return c.json({ ok: true });
});
```

In `app.ts`: add `REVENUECAT_WEBHOOK_SECRET?: string;` to `AppEnv`, `import { webhookRoutes } from "./routes/webhooks";`, `app.route("/v1/webhooks", webhookRoutes);`.

- [ ] **Step 4: Run tests** — `pnpm --filter @oracle/api test -- webhooks` → PASS; full suite green.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): revenuecat webhook writes entitlements — idempotent, lapse keeps bought shields"`

---

### Task 3: Relative shield decrement in settlement

**Files:**
- Modify: `apps/api/src/settlement.ts` (the `usedPaidShield` write, ~L54–58)
- Test: `apps/api/test/settlement.test.ts` (extend)

**Interfaces:**
- Consumes: existing `settleRound`/`settleStreak` (untouched signatures).
- Produces: entitlement decrement is `GREATEST(shields_remaining - 1, 0)` relative, not an absolute set — a rescue purchase landing mid-settle is never clobbered.

- [ ] **Step 1: Write the failing test** — extend `settlement.test.ts` (mirror its existing setup helpers; read the file first):

```ts
it("decrements paid shields relatively — a purchase landing mid-settle is not clobbered", async () => {
  // Setup (use the file's existing helpers/seed pattern): user with streakCurrent 3,
  // free shield already used this month, entitlements.shieldsRemaining = 1, did not play.
  // Simulate the race: after settleRound reads the entitlement row but before it writes,
  // a webhook adds a shield. Deterministic approximation: bump shieldsRemaining to 2
  // via a db.update AFTER seeding but note settleStreak computed from 1 → the guard is
  // the SQL-relative decrement, so final must be 2 - 1 = 1, never settleStreak's 0.
  // Implementation detail: seed shieldsRemaining=2, monkey-not-needed — assert final = 1
  // and streak survived (shield consumed once).
});
```

Concretely: seed `shieldsRemaining: 2`, user misses the day, free shield spent → settle consumes ONE paid shield. Old absolute code sets the value `settleStreak` computed; new code decrements. Assert `shieldsRemaining === 1` and `streakCurrent` preserved. Then a second scenario: `shieldsRemaining: 1` → after settle `0`, never negative.

- [ ] **Step 2: Run to verify current behavior** — with the absolute write the 2-shield case may already pass (settleStreak sees 2 → writes 1); the REAL regression test is the code shape. So ALSO assert via SQL-injection check: replace the write and keep both scenario tests as the behavioral net.
- [ ] **Step 3: Implement** — in `settlement.ts` replace:

```ts
.set({ shieldsRemaining: result.paidShieldsRemaining, updatedAt: new Date() })
```

with:

```ts
.set({ shieldsRemaining: sql`GREATEST(${schema.entitlements.shieldsRemaining} - 1, 0)`, updatedAt: new Date() })
```

(import `sql` from drizzle-orm; `settleStreak` consumes at most one shield per settle by design — assert that assumption in a comment).

- [ ] **Step 4: Run tests** — full api suite green.
- [ ] **Step 5: Commit** — `git commit -m "fix(api): paid-shield decrement is relative — concurrent rescue purchases survive settlement"`

---

### Task 4: Apple identity-token verification

**Files:**
- Create: `apps/api/src/auth/apple.ts`
- Test: `apps/api/test/apple-verify.test.ts`

**Interfaces:**
- Produces: `verifyAppleIdentityToken(token: string, opts: { audience: string; fetchFn?: typeof fetch; nowMs?: number }): Promise<{ sub: string } | null>` — null on ANY failure (bad sig, wrong iss/aud, expired, malformed). JWKS fetched from `https://appleid.apple.com/auth/keys` via injectable `fetchFn`, module-level cached 1h.

- [ ] **Step 1: Write the failing test** — `apple-verify.test.ts` self-signs tokens with a generated RSA key and serves its own JWKS:

```ts
import { describe, it, expect } from "vitest";
import { verifyAppleIdentityToken } from "../src/auth/apple";

const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  return Buffer.from(bytes).toString("base64url");
};

async function makeApple() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const jwks = { keys: [{ ...jwk, kid: "test-kid", use: "sig", alg: "RS256" }] };
  const fetchFn = (async () => new Response(JSON.stringify(jwks))) as unknown as typeof fetch;
  const sign = async (claims: Record<string, unknown>, kid = "test-kid") => {
    const h = b64url(JSON.stringify({ alg: "RS256", kid }));
    const p = b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { fetchFn, sign };
}
const NOW = Date.UTC(2026, 8, 1);
const good = { iss: "https://appleid.apple.com", aud: "com.eriktaheri.oracle", exp: NOW / 1000 + 600, sub: "apple-sub-1" };

describe("verifyAppleIdentityToken", () => {
  it("accepts a valid token and returns sub", async () => {
    const { fetchFn, sign } = await makeApple();
    const out = await verifyAppleIdentityToken(await sign(good), { audience: "com.eriktaheri.oracle", fetchFn, nowMs: NOW });
    expect(out).toEqual({ sub: "apple-sub-1" });
  });
  it("rejects wrong audience, wrong issuer, expiry, unknown kid, bad signature, garbage", async () => {
    const { fetchFn, sign } = await makeApple();
    const opts = { audience: "com.eriktaheri.oracle", fetchFn, nowMs: NOW };
    expect(await verifyAppleIdentityToken(await sign({ ...good, aud: "other.app" }), opts)).toBeNull();
    expect(await verifyAppleIdentityToken(await sign({ ...good, iss: "https://evil.example" }), opts)).toBeNull();
    expect(await verifyAppleIdentityToken(await sign({ ...good, exp: NOW / 1000 - 10 }), opts)).toBeNull();
    expect(await verifyAppleIdentityToken(await sign(good, "other-kid"), opts)).toBeNull();
    const forged = (await sign(good)).slice(0, -6) + "AAAAAA";
    expect(await verifyAppleIdentityToken(forged, opts)).toBeNull();
    expect(await verifyAppleIdentityToken("not.a.jwt", opts)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — module missing.
- [ ] **Step 3: Implement** — `apps/api/src/auth/apple.ts`:

```ts
// Sign in with Apple identity-token verification (spec §4). Workers-safe:
// WebCrypto only, injectable fetch, null on any failure — callers 401.
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISS = "https://appleid.apple.com";
const JWKS_TTL_MS = 3_600_000;

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
function decodeJson(part: string): Record<string, unknown> | null {
  try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>; } catch { return null; }
}

export async function verifyAppleIdentityToken(
  token: string,
  opts: { audience: string; fetchFn?: typeof fetch; nowMs?: number },
): Promise<{ sub: string } | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const nowMs = opts.nowMs ?? Date.now();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h);
  const claims = decodeJson(p);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return null;
  if (claims.iss !== APPLE_ISS || claims.aud !== opts.audience) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;

  if (!jwksCache || nowMs - jwksCache.fetchedAt > JWKS_TTL_MS) {
    const res = await fetchFn(APPLE_JWKS_URL);
    if (!res.ok) return null;
    jwksCache = { keys: ((await res.json()) as { keys: Jwk[] }).keys, fetchedAt: nowMs };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) { jwksCache = null; return null; } // unknown kid: bust cache so a rotated key retries next call

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  } catch { return null; }
  const sig = b64urlToBytes(s);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig as BufferSource, data);
  return ok ? { sub: claims.sub } : null;
}

/** Test hook: reset the module JWKS cache. */
export function __resetJwksCache(): void { jwksCache = null; }
```

Add `beforeEach(() => __resetJwksCache())` to the test file (module cache leaks across tests).

- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): apple identity-token verification — webcrypto, injectable fetch, fail-closed"`

---

### Task 5: Claim / restore / strike endpoints

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (new routes + `deviceAuth` sets `deviceId`), `apps/api/src/app.ts` (env + Variables)
- Test: `apps/api/test/apple-identity.test.ts`

**Interfaces:**
- Consumes: Task 4 `verifyAppleIdentityToken`; Task 1 `users.appleSub`.
- Produces: device-token-authed `POST /v1/auth/apple/claim` (`{identity_token}` → 200 `{claimed:true}` | 409 `{error:"already_claimed"}`), `POST /v1/auth/apple/restore` (→ 200 `{restored:true, user_id}` | 404), `POST /v1/auth/apple/strike` (→ 200 `{struck:true}`). `AppEnv` gains `APPLE_BUNDLE_ID?: string` (default `"com.eriktaheri.oracle"`). `AppContext` Variables gain `deviceId: string`. Pipeline deps: verification is injectable for tests via `Deps` — add optional `verifyApple?: typeof verifyAppleIdentityToken` to `Deps` (tests inject; prod default).

- [ ] **Step 1: Write the failing tests** — `apple-identity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { eq } from "drizzle-orm";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin", APPLE_BUNDLE_ID: "com.eriktaheri.oracle" };
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
```

- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** — in `app.ts`: `AppEnv` gains `APPLE_BUNDLE_ID?: string`; `Deps` gains `verifyApple?: (token: string, opts: { audience: string }) => Promise<{ sub: string } | null>`; Variables gain `deviceId: string`. In `auth.ts`: `deviceAuth` adds `c.set("deviceId", device.id);` after setting userId. Append to `authRoutes` (chained after `.post("/device", ...)` so the export type stays one chain):

```ts
.post("/apple/claim", deviceAuth, async (c) => {
  const { db, env, verifyApple } = c.get("deps");
  const body = z.object({ identity_token: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const verify = verifyApple ?? ((t: string, o: { audience: string }) => verifyAppleIdentityToken(t, o));
  const idt = await verify(body.data.identity_token, { audience: env.APPLE_BUNDLE_ID ?? "com.eriktaheri.oracle" });
  if (!idt) return c.json({ error: "unauthorized" }, 401);
  const bound = await db.query.users.findFirst({ where: eq(schema.users.appleSub, idt.sub) });
  const userId = c.get("userId");
  if (bound && bound.id !== userId) return c.json({ error: "already_claimed" }, 409);
  if (!bound) await db.update(schema.users).set({ appleSub: idt.sub }).where(eq(schema.users.id, userId));
  return c.json({ claimed: true });
})
.post("/apple/restore", deviceAuth, async (c) => {
  const { db, env, verifyApple } = c.get("deps");
  const body = z.object({ identity_token: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const verify = verifyApple ?? ((t: string, o: { audience: string }) => verifyAppleIdentityToken(t, o));
  const idt = await verify(body.data.identity_token, { audience: env.APPLE_BUNDLE_ID ?? "com.eriktaheri.oracle" });
  if (!idt) return c.json({ error: "unauthorized" }, 401);
  const bound = await db.query.users.findFirst({ where: eq(schema.users.appleSub, idt.sub) });
  if (!bound) return c.json({ error: "no record" }, 404);
  // The claimed record wins; the fresh row is abandoned, never merged (spec §4).
  await db.update(schema.devices).set({ userId: bound.id }).where(eq(schema.devices.id, c.get("deviceId")));
  return c.json({ restored: true, user_id: bound.id });
})
.post("/apple/strike", deviceAuth, async (c) => {
  const { db } = c.get("deps");
  const userId = c.get("userId");
  // Child rows first; neon-http has no transactions — worst crash leaves an orphaned empty user, re-strikeable.
  await db.delete(schema.predictions).where(eq(schema.predictions.userId, userId));
  await db.delete(schema.entitlements).where(eq(schema.entitlements.userId, userId));
  await db.delete(schema.devices).where(eq(schema.devices.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  return c.json({ struck: true });
});
```

(imports: `verifyAppleIdentityToken` from `../auth/apple`.)

- [ ] **Step 4: Run tests** — new file + full api suite green (the `Deps` change must not break existing `createApp({db, env})` callers — field is optional).
- [ ] **Step 5: Commit** — `git commit -m "feat(api): sign in with apple — claim, restore, strike; claimed record always wins"`

---

### Task 6: Machine-voice copy — paywall, rescue, campaign

**Files:**
- Modify: `packages/core/src/copy.ts`, `packages/core/src/index.ts` (exports), `packages/core/test/copy-lint.test.ts`
- Test: `packages/core/test/copy-lint.test.ts` (extended coverage)

**Interfaces:**
- Produces: `PAYWALL_LINES: ReadonlyArray<CopyLine>` (pool `"paywall"` added to the `CopyLine` pool union, lines appended to `COPY_BANK`), `PAYWALL_CTA_LINES` frozen const (CTA labels — outside `COPY_BANK`, exempt from the no-CTA rule by construction), `PUSH_CAMPAIGN_LINES` frozen const (OneSignal dashboard source of truth). All exported from `@oracle/core`.

- [ ] **Step 1: Read the lint** — read `packages/core/test/copy-lint.test.ts` fully. The lint is the voice's guardian: extend it, never weaken it. Pool-shape checks must learn the new pool.
- [ ] **Step 2: Write failing lint extensions** — add to the lint file: `PAYWALL_CTA_LINES`/`PUSH_CAMPAIGN_LINES` are ALL CAPS, no emoji, no `!`, ≤32 chars (CTA) / ≤140 (push); every `pool: "paywall"` line passes the standard bank rules.
- [ ] **Step 3: Implement** — in `copy.ts`: pool union becomes `"noon" | "closing" | "streak" | "system" | "paywall"`. Append to `COPY_BANK`:

```ts
// ── paywall: the shield offer. Protection, never pressure. No CTA verbs here —
// button labels live in PAYWALL_CTA_LINES by construction. ──
{ id: "paywall.creed-1", pool: "paywall", text: "THE VIGIL IS FRAGILE. THE SHIELD IS NOT." },
{ id: "paywall.creed-2", pool: "paywall", text: "A MISSED NOON NEED NOT END THE RECORD." },
{ id: "paywall.creed-3", pool: "paywall", text: "THE ORACLE FORGIVES ONCE A MONTH. PLUS FORGIVES MORE." },
{ id: "paywall.rescue-1", pool: "paywall", text: "YOUR VIGIL ENDS AT NOON. ONE SHIELD WOULD HOLD IT.", requires: ["streak"] },
{ id: "paywall.terms-1", pool: "paywall", text: "PAYING NEVER IMPROVES A PROPHECY. ONLY PROTECTS ITS RECORD." },
```

New consts (after `COPY_BANK`):

```ts
// Purchase-button labels. Deliberately OUTSIDE the bank: the no-CTA-verb law
// governs ambient copy; a button IS a CTA. Mini-lint: caps, no emoji/!, ≤32.
export const PAYWALL_CTA_LINES = Object.freeze({
  subscribe: "KEEP THE VIGIL",
  rescue: "RAISE THE SHIELD",
  restore: "RECOVER PURCHASES",
} as const);

// OneSignal dashboard campaign copy — the repo is the source of truth; the
// dashboard is a paste target (spec §5). Standard bank rules apply.
export const PUSH_CAMPAIGN_LINES = Object.freeze({
  plusWelcome: "THE SHIELD IS RAISED. YOUR VIGIL IS PROTECTED.",
} as const);
```

Export all from `packages/core/src/index.ts` alongside existing copy exports.

- [ ] **Step 4: Run** — `pnpm --filter @oracle/core test` green (lint + any pool-shape fixtures updated).
- [ ] **Step 5: Commit** — `git commit -m "feat(core): paywall voice — creed lines in the bank, CTA labels quarantined outside it"`

---

### Task 7: Mobile native deps, config plugins, EAS profiles

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/app.json`
- Create: `apps/mobile/eas.json`, `apps/mobile/src/config/keys.ts`

**Interfaces:**
- Produces: installed `react-native-purchases`, `react-native-onesignal`, `onesignal-expo-plugin`, `expo-apple-authentication`, `posthog-react-native`, `@sentry/react-native`, `expo-dev-client`. `keys.ts` exports `KEYS = { rcIos, oneSignalAppId, posthog, posthogHost, sentryDsn }` (all `string | undefined` from `process.env.EXPO_PUBLIC_*`). Every later task guards on these. EAS profiles `development`/`preview`/`production`.

- [ ] **Step 1: Install** — from `apps/mobile`: `npx expo install react-native-purchases expo-apple-authentication expo-dev-client posthog-react-native @sentry/react-native react-native-onesignal onesignal-expo-plugin`. (`npx expo install` picks SDK-57-compatible versions; if a package isn't in expo's mapping it falls through to latest — pin whatever it resolves.) Remember the repo gotcha: run from `apps/mobile`, never root; `.npmrc` is hoisted — every import must be declared.
- [ ] **Step 2: Config** — `app.json` additions (verbatim; keep existing content):

```json
{
  "expo": {
    "ios": { "usesAppleSignIn": true },
    "plugins": [
      "expo-apple-authentication",
      ["onesignal-expo-plugin", { "mode": "production" }],
      ["@sentry/react-native/expo", { "organization": "SENTRY_ORG_TBD_BY_ERIK", "project": "oracle-mobile" }]
    ]
  }
}
```

(Merge into the existing `plugins` array — `expo-font` etc. already live there. The Sentry org placeholder is inert until Task 12 fills it; the plugin tolerates it for local typecheck but `eas build` needs the real value — flagged in Task 12.)

`eas.json`:

```json
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "ios": { "simulator": false } },
    "preview": { "distribution": "internal" },
    "production": { "autoIncrement": true }
  },
  "submit": { "production": {} }
}
```

`src/config/keys.ts`:

```ts
// Native-SDK keys. All optional: absent key = that SDK stays dark and the app
// still runs (Global Constraint: degrade, never crash, pre-account).
export const KEYS = {
  rcIos: process.env.EXPO_PUBLIC_RC_IOS_KEY,
  oneSignalAppId: process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID,
  posthog: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
} as const;
```

- [ ] **Step 3: Verify** — `pnpm --filter @oracle/mobile typecheck` green; `pnpm --filter @oracle/mobile test` green. Metro still starts (`npx expo start` from apps/mobile) — native modules are absent in Expo Go, which is fine: nothing imports them yet.
- [ ] **Step 4: Commit** — `git commit -m "feat(mobile): native sdk deps, config plugins, eas profiles — the dev-client era begins"`

---

### Task 8: Purchases module + plus-state plumbing

**Files:**
- Create: `apps/mobile/src/monetization/purchases.ts`, `apps/mobile/src/monetization/plusState.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` (init call)
- Test: `apps/mobile/test/plusState.test.ts`

**Interfaces:**
- Consumes: `KEYS.rcIos` (Task 7); device id from `src/api/auth.ts` (read that file: it mints/stores the token — expose `getDeviceId()` if absent by parsing the stored token's first segment).
- Produces: `initPurchases(): Promise<void>` (no-op without key); `getOffering(): Promise<PurchasesOffering | null>`; `purchasePackage(pkg)`, `purchaseRescue(): Promise<boolean>`, `restore(): Promise<void>`; `usePlus(): { plusActive: boolean; loading: boolean }` hook backed by a zustand store fed from `Purchases.addCustomerInfoUpdateListener`. Pure: `plusFromCustomerInfo(info: { entitlements: { active: Record<string, unknown> } }): boolean` (tests this).

- [ ] **Step 1: Failing test** — `apps/mobile/test/plusState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { plusFromCustomerInfo } from "../src/monetization/plusState";

describe("plusFromCustomerInfo", () => {
  it("is true iff the plus entitlement is active", () => {
    expect(plusFromCustomerInfo({ entitlements: { active: { plus: {} } } })).toBe(true);
    expect(plusFromCustomerInfo({ entitlements: { active: {} } })).toBe(false);
    expect(plusFromCustomerInfo({ entitlements: { active: { other: {} } } })).toBe(false);
  });
});
```

- [ ] **Step 2: FAIL, then implement** — `plusState.ts` is RN-free (testable):

```ts
import { create } from "zustand";

export function plusFromCustomerInfo(info: { entitlements: { active: Record<string, unknown> } }): boolean {
  return "plus" in info.entitlements.active;
}
export const usePlusStore = create<{ plusActive: boolean; loading: boolean; set: (v: boolean) => void }>((set) => ({
  plusActive: false, loading: true, set: (v) => set({ plusActive: v, loading: false }),
}));
```

`purchases.ts` (RN module — typecheck + manual pass, no unit test):

```ts
import Purchases, { type PurchasesOffering, type PurchasesPackage } from "react-native-purchases";
import { KEYS } from "../config/keys";
import { getDeviceId } from "../api/auth";
import { plusFromCustomerInfo, usePlusStore } from "./plusState";

let configured = false;
export async function initPurchases(): Promise<void> {
  if (configured || !KEYS.rcIos) { usePlusStore.getState().set(false); return; }
  const deviceId = await getDeviceId();
  if (!deviceId) { usePlusStore.getState().set(false); return; }
  Purchases.configure({ apiKey: KEYS.rcIos, appUserID: deviceId }); // spec §2: app user ID = device ID, forever
  configured = true;
  Purchases.addCustomerInfoUpdateListener((info) => usePlusStore.getState().set(plusFromCustomerInfo(info)));
  try { usePlusStore.getState().set(plusFromCustomerInfo(await Purchases.getCustomerInfo())); } catch { usePlusStore.getState().set(false); }
}
export async function getOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try { return (await Purchases.getOfferings()).current; } catch { return null; }
}
export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  try { const { customerInfo } = await Purchases.purchasePackage(pkg); usePlusStore.getState().set(plusFromCustomerInfo(customerInfo)); return true; }
  catch { return false; } // user-cancelled and store errors land here; UI shows the quiet error line
}
export async function purchaseRescue(): Promise<boolean> {
  if (!configured) return false;
  try {
    const products = await Purchases.getProducts(["shield_rescue"]);
    if (!products[0]) return false;
    await Purchases.purchaseStoreProduct(products[0]);
    return true;
  } catch { return false; }
}
export async function restore(): Promise<void> {
  if (!configured) return;
  try { usePlusStore.getState().set(plusFromCustomerInfo(await Purchases.restorePurchases())); } catch {}
}
```

If `src/api/auth.ts` lacks `getDeviceId`, add it there: parse the SecureStore token's first `.`-segment (the deviceId — see `deviceToken.ts` format), returning `string | null`. Wire `initPurchases()` in `_layout.tsx` alongside existing startup effects (fire-and-forget, after fonts).

- [ ] **Step 3: Verify** — mobile tests + typecheck green.
- [ ] **Step 4: Commit** — `git commit -m "feat(mobile): revenuecat plumbing — device-id identity, offerings, plus state, graceful dark mode"`

---

### Task 9: The paywall screen `/plus` + entry points

**Files:**
- Create: `apps/mobile/src/app/plus.tsx`
- Modify: `apps/mobile/src/app/index.tsx` (lapse/risk notices link + rescue row), `apps/mobile/src/app/ledger.tsx` (plaque row)
- Test: none new (RN screens = typecheck + manual pass; copy already linted in Task 6)

**Interfaces:**
- Consumes: Task 8's `getOffering/purchasePackage/purchaseRescue/restore/usePlus`; Task 6's `PAYWALL_CTA_LINES`, paywall pool lines; existing UI kit (`Screen`, `TopBar`, `Eyebrow`, `Mono`, `Ritual`, `DecodeLine`, `GoldButton`, `QuietLink`, `colors`, `space`).
- Produces: route `/plus`; home's streak-at-risk/lapse notices become links to `/plus`; when at-risk AND no shield, home shows the one-row rescue offer.

- [ ] **Step 1: Build `/plus`** — structure (follow the ledger screen's card pattern; prices ALWAYS from `pkg.product.priceString`, never hardcoded):

```tsx
import { useEffect, useState } from "react";
import { View, Linking, Pressable } from "react-native";
import type { PurchasesOffering, PurchasesPackage } from "react-native-purchases";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { colors, space } from "../theme";
import { COPY_BANK, PAYWALL_CTA_LINES } from "@oracle/core";
import { getOffering, purchasePackage, restore } from "../monetization/purchases";
import { usePlusStore } from "../monetization/plusState";

const CREED = COPY_BANK.filter((l) => l.pool === "paywall" && l.id.startsWith("paywall.creed"));
const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_URL = "https://PRIVACY_URL_TBD_TASK_12"; // Task 12 replaces with Erik's real URL before submission

export default function Plus() {
  const [offering, setOffering] = useState<PurchasesOffering | null | "loading">("loading");
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const plusActive = usePlusStore((s) => s.plusActive);
  useEffect(() => { getOffering().then(setOffering); }, []);

  const buy = async (pkg: PurchasesPackage) => {
    setErrorLine(null);
    if (!(await purchasePackage(pkg))) setErrorLine("THE STORE DID NOT ANSWER. NOTHING WAS CHARGED.");
  };

  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>Oracle plus</Eyebrow>
        <View style={{ gap: space(2) }}>
          {CREED.map((l, i) => (
            <DecodeLine key={l.id} text={l.text} delayMs={i * 160} durationMs={450} size={12} color={colors.ink} letterSpacing={2} style={{ lineHeight: 20, textAlign: "center" }} />
          ))}
        </View>
        {plusActive ? (
          <Mono size={11} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>THE SHIELD IS RAISED. YOUR VIGIL IS PROTECTED.</Mono>
        ) : offering === "loading" ? (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>CONSULTING THE STORE…</Mono>
        ) : offering === null ? (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>THE STORE IS BEYOND THE VEIL. RETURN LATER.</Mono>
        ) : (
          <View style={{ gap: space(2) }}>
            {offering.annual && <PriceRow pkg={offering.annual} tag="TWELVE MOONS" onPress={buy} featured />}
            {offering.monthly && <PriceRow pkg={offering.monthly} tag="ONE MOON" onPress={buy} />}
          </View>
        )}
        {errorLine && <Mono size={10} color={colors.vermilion} letterSpacing={2} style={{ textAlign: "center" }}>{errorLine}</Mono>}
        <Mono size={9} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center", lineHeight: 15 }}>
          AUTO-RENEWS UNTIL CANCELLED IN APP STORE SETTINGS. THE FREE GAME IS NEVER GATED.
        </Mono>
      </View>
      <View style={{ gap: space(2), paddingBottom: space(2) }}>
        <QuietLink title="Recover purchases" onPress={() => restore()} />
        <View style={{ flexDirection: "row", justifyContent: "center", gap: space(4) }}>
          <Pressable onPress={() => Linking.openURL(TERMS_URL)}><Mono size={9} color={colors.mutedInk} letterSpacing={1}>TERMS</Mono></Pressable>
          <Pressable onPress={() => Linking.openURL(PRIVACY_URL)}><Mono size={9} color={colors.mutedInk} letterSpacing={1}>PRIVACY</Mono></Pressable>
        </View>
      </View>
    </Screen>
  );
}

function PriceRow({ pkg, tag, onPress, featured }: { pkg: PurchasesPackage; tag: string; onPress: (p: PurchasesPackage) => void; featured?: boolean }) {
  return (
    <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: featured ? colors.agedGold : colors.mutedInk, padding: space(3), gap: space(2) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Mono size={10} color={colors.mutedInk} letterSpacing={2}>{tag}</Mono>
        <Ritual bold size={20} color={colors.ink} letterSpacing={1}>{pkg.product.priceString}</Ritual>
      </View>
      <GoldButton title={PAYWALL_CTA_LINES.subscribe} onPress={() => onPress(pkg)} />
    </View>
  );
}
```

(Check actual `Ritual`/`GoldButton`/`QuietLink` props against `src/ui` before writing — match what exists, e.g. `QuietLink` takes `title`. `colors.vermilion`/`mutedInk` names verified against `theme.ts`; adjust to the real token names if they differ.)

- [ ] **Step 2: Entry points** — in `index.tsx`, find the streak-at-risk/lapse notice block (priority shield>risk>lapse>vigil from the loop-clarity pass). Wrap the risk and lapse notices in a `Pressable` routing to `/plus`. Below the risk notice, when `usePlusStore` says no plus and the ledger shows no shields, render the rescue row: the `paywall.rescue-1` line (with `{streak}` filled via `fillSlots`) + `GoldButton title={PAYWALL_CTA_LINES.rescue}` calling `purchaseRescue()`; on success swap to `streak.shield-1`'s text as confirmation, on failure the store-silent error line. Keep the fixed-height footer-slot discipline (height-40 rule from the swipe pass applies to home notices — read the surrounding code and preserve layout).
- [ ] **Step 3: Plaque row** — in `ledger.tsx` add under the stats: unbound-plus state shows a `QuietLink title="Oracle plus"` → `/plus`.
- [ ] **Step 4: Verify** — typecheck + tests green; Metro renders `/plus` via deep link `exp://…/--/plus` in the sim (mock-dark mode shows "THE STORE IS BEYOND THE VEIL" — correct pre-keys behavior). Screenshot to `docs/superpowers/plans/assets/revenue-rites/paywall-dark-mode.png`.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): the paywall — creed, two moons, rescue at the breaking point"`

---

### Task 10: SIWA client — claim, restore, strike

**Files:**
- Create: `apps/mobile/src/api/identity.ts`
- Modify: `apps/mobile/src/app/ledger.tsx` (claim/struck rows), `apps/mobile/src/app/summons.tsx` (restore row), `apps/mobile/src/api/auth.ts` (post-restore/strike token handling)
- Test: none new (native module screens; endpoint logic tested in Task 5)

**Interfaces:**
- Consumes: Task 5 endpoints; `expo-apple-authentication`.
- Produces: `identity.ts` exports `appleClaim(): Promise<"claimed" | "collision" | "cancelled" | "failed">`, `appleRestore(): Promise<"restored" | "none" | "cancelled" | "failed">`, `strikeRecord(): Promise<boolean>`; `auth.ts` gains `clearDeviceToken(): Promise<void>` (SecureStore delete — used after strike so next launch mints fresh).

- [ ] **Step 1: Implement `identity.ts`**:

```ts
import * as AppleAuthentication from "expo-apple-authentication";
import { api, ApiError } from "./client";
import { getDeviceToken, clearDeviceToken } from "./auth";
import { z } from "zod";

async function identityToken(): Promise<string | "cancelled" | null> {
  try {
    const cred = await AppleAuthentication.signInAsync({ requestedScopes: [] }); // no name/email — claim needs only the sub
    return cred.identityToken ?? null;
  } catch (e) {
    return (e as { code?: string }).code === "ERR_REQUEST_CANCELED" ? "cancelled" : null;
  }
}
export async function appleClaim() {
  const idt = await identityToken();
  if (idt === "cancelled") return "cancelled" as const;
  if (!idt) return "failed" as const;
  try {
    await api("/v1/auth/apple/claim", z.object({ claimed: z.boolean() }), { method: "POST", token: await getDeviceToken(), body: JSON.stringify({ identity_token: idt }) });
    return "claimed" as const;
  } catch (e) {
    return e instanceof ApiError && e.status === 409 ? ("collision" as const) : ("failed" as const);
  }
}
export async function appleRestore() {
  const idt = await identityToken();
  if (idt === "cancelled") return "cancelled" as const;
  if (!idt) return "failed" as const;
  try {
    await api("/v1/auth/apple/restore", z.object({ restored: z.boolean(), user_id: z.string() }), { method: "POST", token: await getDeviceToken(), body: JSON.stringify({ identity_token: idt }) });
    return "restored" as const;
  } catch (e) {
    return e instanceof ApiError && e.status === 404 ? ("none" as const) : ("failed" as const);
  }
}
export async function strikeRecord(): Promise<boolean> {
  try {
    await api("/v1/auth/apple/strike", z.object({ struck: z.boolean() }), { method: "POST", token: await getDeviceToken(), body: JSON.stringify({}) });
    await clearDeviceToken();
    return true;
  } catch { return false; }
}
```

(Adapt the `api()` call shape to `client.ts` exactly — it takes `(path, schema, init)`; body via init as shown. Read `auth.ts` for the SecureStore key name when adding `clearDeviceToken`.)

- [ ] **Step 2: Plaque rows** — `ledger.tsx`: needs claim state; extend `GET /v1/me/ledger`? NO — keep it client-cheap: add `claimed: boolean` to the ledger response in Task 5? It wasn't. Ruling: add it here, server-side, one line in `apps/api/src/routes/me.ts` ledger handler (`claimed: user.appleSub !== null`) + `MeLedgerSchema` in core + one assertion in `apps/api/test/ledger.test.ts`. Then in `ledger.tsx`: unclaimed → native `AppleAuthenticationButton` (type `SIGN_IN`, style `BLACK`, height 44 — Apple HIG requires their button for the trigger) with an `Eyebrow` "Claim your record" above; claimed → `Mono` row "THE RECORD IS CLAIMED". Quiet footer: `QuietLink title="Strike the record"` → RN `Alert.alert("THE RECORD WILL BE STRUCK", "THIS IS NOT UNDONE.", [cancel, destructive confirm])` → `strikeRecord()` → `router.replace("/")`. Claim collision → `Alert` with "THE RECORD ALREADY BEARS A NAME." offering RESTORE (calls `appleRestore`) or CANCEL (spec §4 collision ruling).
- [ ] **Step 3: Summons restore row** — `summons.tsx` gains under the existing buttons: `QuietLink title="Restore a claimed record"` → `appleRestore()`; on `"restored"` invalidate ALL react-query caches (`useQueryClient().invalidateQueries()`) and `router.replace("/")`; on `"none"` show a `Mono` line "NO RECORD BEARS THIS NAME."
- [ ] **Step 4: Verify** — typecheck green; sim smoke: rows render (Apple sheet itself needs the dev client + capability — manual pass lands in Task 13).
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): claim, restore, strike — the record survives the phone"`

---

### Task 11: OneSignal init, summons wiring, PostHog, Sentry

**Files:**
- Create: `apps/mobile/src/notifications/onesignal.ts`, `apps/mobile/src/analytics/analytics.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` (inits), `apps/mobile/src/app/summons.tsx` (prompt path), call sites listed below
- Test: none new (all RN-native; keys absent = dark)

**Interfaces:**
- Consumes: `KEYS` (Task 7), device id (Task 8’s `getDeviceId`).
- Produces: `initOneSignal()`, `requestPushPermission(): Promise<void>`; `capture(event: AnalyticsEvent, props?: Record<string, unknown>)` with `type AnalyticsEvent = "round_opened" | "question_answered" | "round_locked" | "reveal_viewed" | "card_shared" | "paywall_viewed" | "purchase_completed" | "shield_used" | "record_claimed"`; Sentry initialized when DSN present.

- [ ] **Step 1: `onesignal.ts`**:

```ts
import { OneSignal, LogLevel } from "react-native-onesignal";
import { KEYS } from "../config/keys";
import { getDeviceId } from "../api/auth";

let ready = false;
export async function initOneSignal(): Promise<void> {
  if (ready || !KEYS.oneSignalAppId) return;
  OneSignal.Debug.setLogLevel(LogLevel.None);
  OneSignal.initialize(KEYS.oneSignalAppId);
  const deviceId = await getDeviceId();
  if (deviceId) OneSignal.login(deviceId); // external id = device id (spec §5)
  ready = true;
}
export async function requestPushPermission(): Promise<void> {
  if (!ready) return;
  await OneSignal.Notifications.requestPermission(false); // false: no fallback re-prompt — the summons is the only ask
}
```

- [ ] **Step 2: Summons wiring** — in `summons.tsx`, `LET IT SPEAK`'s handler becomes: `initOneSignal()` is already done at boot; call `await requestPushPermission()` FIRST, falling back to the existing `Notifications.requestPermissionsAsync()` only when `KEYS.oneSignalAppId` is absent (local reminders still need permission in dark mode). Keep `leave()` after either path; the existing once-ever flag logic is untouched.
- [ ] **Step 3: `analytics.ts`**:

```ts
import PostHog from "posthog-react-native";
import { KEYS } from "../config/keys";

export type AnalyticsEvent = "round_opened" | "question_answered" | "round_locked" | "reveal_viewed" | "card_shared" | "paywall_viewed" | "purchase_completed" | "shield_used" | "record_claimed";
let client: PostHog | null = null;
export function initAnalytics(): void {
  if (client || !KEYS.posthog) return;
  client = new PostHog(KEYS.posthog, { host: KEYS.posthogHost });
}
export function capture(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  client?.capture(event, props);
}
```

Call sites (add `capture(...)` one line each; find the exact spots by reading each file): `round_opened` in `index.tsx` when a live round renders; `question_answered` in `round.tsx` at successful seal; `reveal_viewed` in the reveal screen on outcome render; `card_shared` where `shareSnapshot` succeeds (round spread + plaque); `paywall_viewed` in `plus.tsx` mount; `purchase_completed` in `purchases.ts` on successful `purchasePackage`/`purchaseRescue`; `record_claimed` in `identity.ts` on `"claimed"`. (`round_locked`/`shield_used` are server-observed states — skip client capture; the PostHog dashboard reads them from reveal views. Note this in a comment.)

- [ ] **Step 4: Sentry** — in `_layout.tsx`, top of module: `import * as Sentry from "@sentry/react-native"; if (KEYS.sentryDsn) Sentry.init({ dsn: KEYS.sentryDsn });` and wrap the export per `@sentry/react-native/expo` docs (`Sentry.wrap(Layout)`) only when DSN present is fine — wrap unconditionally (no-DSN wrap is inert). Also `initAnalytics()` + `initOneSignal()` fire-and-forget beside `initPurchases()`.
- [ ] **Step 5: Verify** — typecheck + tests + sim smoke (all dark, no crashes without keys). Commit — `git commit -m "feat(mobile): onesignal summons, posthog events, sentry — every sense guarded by its key"`

---

### Task 12: ⛔ GATED (ERIK) — accounts, dashboards, first dev build

**Files:**
- Modify: `apps/mobile/app.json` (real Sentry org), `apps/mobile/src/app/plus.tsx` (real privacy URL), `apps/api/wrangler.jsonc` env docs
- Create: `docs/superpowers/plans/assets/revenue-rites/dashboard-runbook.md` (record of what was configured)

This task is a runbook — the executor prepares everything preparable, then hands Erik the ordered checklist. Nothing here blocks Tasks 1–11.

- [ ] **Step 1 (ERIK): Accounts** — in order: (1) Apple Developer enrollment; (2) RevenueCat account DIRECT (not Stripe Projects — spec §0) + iOS app with bundle id `com.eriktaheri.oracle`; (3) OneSignal account **via the Shipaton perk link** (free Growth) + iOS app; (4) PostHog project; (5) Sentry org+project `oracle-mobile`; (6) domain + privacy-policy URL.
- [ ] **Step 2 (ERIK+executor): App Store Connect** — app record; subscription group `oracle_plus` with `plus_monthly` $2.99 + `plus_annual` $19.99; consumable `shield_rescue` $1.99; offer codes for `plus_monthly` (judges); App Privacy questionnaire (identifiers: device ID; purchases; diagnostics; NO tracking → no ATT prompt).
- [ ] **Step 3 (executor): RevenueCat dashboard** — entitlement `plus` ← both subscription products; offering `default` (annual featured); webhook → `https://<prod-worker-domain>/v1/webhooks/revenuecat` with Authorization `Bearer <REVENUECAT_WEBHOOK_SECRET>`; enable OneSignal integration (external-id mode). `wrangler secret put REVENUECAT_WEBHOOK_SECRET`.
- [ ] **Step 4 (executor): OneSignal dashboard** — the deployed campaign (spec §5, award requirement): Journey/automated message triggered on the RevenueCat `initial_purchase` event/tag, message text EXACTLY `PUSH_CAMPAIGN_LINES.plusWelcome` from core. Screenshot the live config → assets dir (Devpost evidence).
- [ ] **Step 5 (executor): Keys into EAS** — `eas env:create` per profile: `EXPO_PUBLIC_RC_IOS_KEY`, `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_API_URL=<prod worker URL>`. Fill real Sentry org in `app.json`; real privacy URL in `plus.tsx`.
- [ ] **Step 6 (executor): First dev build** — `eas build --profile development --platform ios` (SIWA capability auto from `usesAppleSignIn`; push capability from the OneSignal plugin); install on Erik's phone; `npx expo start --dev-client`.
- [ ] **Step 7:** Apply migrations 0004 (and any pending) to dev + prod Neon via psql (existing convention). Commit config changes.

---

### Task 13: ⛔ GATED (ERIK) — device passes, store assets, submission

- [ ] **Step 1: Manual device pass** (all on the dev client, sandbox App Store account; record results in the assets dir): (a) sandbox `plus_monthly` purchase → webhook fires → `entitlements.plusActive` true in dev DB → miss a day → shield holds streak; (b) rescue purchase at a real lapse notice → `shieldsRemaining` +1; (c) restore purchases on a reinstall; (d) SIWA claim → delete app → reinstall → restore → streak intact; (e) strike → fresh anonymous start; (f) summons → OS prompt → test push from dashboard received; (g) paywall prices render from StoreKit.
- [ ] **Step 2: Store assets** — screenshots 1179×2556 frameless (home with live round, card mid-pull, reveal ceremony, plaque, share card), icon already exists; listing copy in machine voice with ZERO betting vocabulary (design spec §5a.4 — no "bet/odds/wager/payout" anywhere).
- [ ] **Step 3: Review-proofing** — arm prod pipeline BEFORE submitting (secrets + `PIPELINE_ENABLED="true"`, seeded bank); review notes: what the app is, content rotates daily at noon ET, offer code for Oracle Plus, note that the reviewer's first open shows a live round.
- [ ] **Step 4: Submit** — `eas build --profile production` → `eas submit`; target window Sept 15–19.

---

## Self-review notes

- **Spec coverage:** §2 → Tasks 2/3/8/12; §3 → Tasks 6/9; §4 → Tasks 1/4/5/10; §5 → Tasks 11/12; §6 → Task 11; §7 → Tasks 7/12/13; §8 → every task's steps + Task 13. §2 offer codes → Task 12 Step 2. §9 Erik items → Tasks 12/13 checklists.
- **Type consistency:** `verifyApple` injectable shape matches Task 4's exported signature; `plusFromCustomerInfo` input shape matches RC's `CustomerInfo.entitlements.active`; `KEYS` consumed by Tasks 8/11 as defined in 7; `PAYWALL_CTA_LINES.{subscribe,rescue,restore}` defined in 6, used in 9/10.
- **Known intentional deviations for executors:** Task 9/10 tell the executor to verify UI-kit prop names against `src/ui` before writing — the components exist; exact props may drift from this plan's usage. Task 5 adds `claimed` to the ledger response inside Task 10 Step 2 (small cross-task addition, called out explicitly there).
