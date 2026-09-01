import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { and, count, eq, gt } from "drizzle-orm";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { mintDeviceToken, verifyDeviceToken, sha256Hex } from "../auth/deviceToken";
import { verifyAppleIdentityToken } from "../auth/apple";

const BodySchema = z.object({ platform: z.enum(["ios", "android"]) });

export const MINT_LIMIT = 5;
export const MINT_WINDOW_MS = 3_600_000;

/** Middleware: sets userId from a valid bearer device token. */
export const deviceAuth = createMiddleware<AppContext>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const { db, env } = c.get("deps");
  const deviceId = token ? await verifyDeviceToken(env.DEVICE_TOKEN_SECRET, token) : null;
  if (!deviceId) return c.json({ error: "unauthorized" }, 401);
  const device = await db.query.devices.findFirst({ where: eq(schema.devices.id, deviceId) });
  if (!device) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", device.userId);
  c.set("deviceId", device.id);
  await next();
});

export const authRoutes = new Hono<AppContext>().post("/device", async (c) => {
  const parsed = BodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const { db, env } = c.get("deps");

  // Sybil brake: a salted hash of the minting IP, MINT_LIMIT per hour. The
  // salt is the token secret so the hash is useless outside this deployment.
  // No header (tests, local wrangler) → no throttle; Cloudflare always sets it.
  const ip = c.req.header("cf-connecting-ip");
  const ipHash = ip ? await sha256Hex(`${ip}:${env.DEVICE_TOKEN_SECRET}`) : null;
  if (ipHash) {
    const since = new Date(Date.now() - MINT_WINDOW_MS);
    const [row] = await db.select({ n: count() }).from(schema.devices).where(and(eq(schema.devices.ipHash, ipHash), gt(schema.devices.createdAt, since)));
    if (Number(row?.n ?? 0) >= MINT_LIMIT) return c.json({ error: "too many devices" }, 429);
  }

  const deviceId = crypto.randomUUID();
  const token = await mintDeviceToken(env.DEVICE_TOKEN_SECRET, deviceId, Date.now());
  const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
  await db.insert(schema.devices).values({
    id: deviceId,
    userId: user!.id,
    installTokenHash: await sha256Hex(token),
    platform: parsed.data.platform,
    ipHash,
  });
  return c.json({ token, user_id: user!.id });
})
.post("/apple/claim", deviceAuth, async (c) => {
  const { db, env, verifyApple } = c.get("deps");
  const body = z.object({ identity_token: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const verify = verifyApple ?? ((t: string, o: { audience: string }) => verifyAppleIdentityToken(t, o));
  const idt = await verify(body.data.identity_token, { audience: env.APPLE_BUNDLE_ID ?? "com.erikcitrine.oracle" });
  if (!idt) return c.json({ error: "unauthorized" }, 401);
  const bound = await db.query.users.findFirst({ where: eq(schema.users.appleSub, idt.sub) });
  const userId = c.get("userId");
  if (bound && bound.id !== userId) return c.json({ error: "already_claimed" }, 409);
  if (!bound) {
    try {
      await db.update(schema.users).set({ appleSub: idt.sub }).where(eq(schema.users.id, userId));
    } catch (e) {
      // Race: two unbound users both read bound === null for the same sub
      // (users.apple_sub is DB-unique, and this read-then-write isn't
      // transactional), then both UPDATE — the loser hits the unique
      // constraint. Re-check who actually won: if it's someone else, that's
      // a legitimate already_claimed, not a real failure. Anything else
      // rethrows rather than swallowing an unrelated DB error.
      const now = await db.query.users.findFirst({ where: eq(schema.users.appleSub, idt.sub) });
      if (now && now.id !== userId) return c.json({ error: "already_claimed" }, 409);
      throw e;
    }
  }
  return c.json({ claimed: true });
})
.post("/apple/restore", deviceAuth, async (c) => {
  const { db, env, verifyApple } = c.get("deps");
  const body = z.object({ identity_token: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  const verify = verifyApple ?? ((t: string, o: { audience: string }) => verifyAppleIdentityToken(t, o));
  const idt = await verify(body.data.identity_token, { audience: env.APPLE_BUNDLE_ID ?? "com.erikcitrine.oracle" });
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
