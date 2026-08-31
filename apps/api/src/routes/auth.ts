import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { and, count, eq, gt } from "drizzle-orm";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { mintDeviceToken, verifyDeviceToken, sha256Hex } from "../auth/deviceToken";

const BodySchema = z.object({ platform: z.enum(["ios", "android"]) });

export const MINT_LIMIT = 5;
export const MINT_WINDOW_MS = 3_600_000;

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
});

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
  await next();
});
