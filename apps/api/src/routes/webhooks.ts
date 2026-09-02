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
// Events that represent a new billing period — the only ones that earn a shield grant.
// UNCANCELLATION and PRODUCT_CHANGE reactivate/modify an existing period, they don't start one.
const SHIELD_GRANTING = ["INITIAL_PURCHASE", "RENEWAL"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Design spec §5: "everyone gets one free auto-shield per month; Plus gets more."
// Copy: "THE ORACLE FORGIVES ONCE A MONTH. PLUS FORGIVES MORE." (paywall.creed-3)
export const PLUS_SHIELDS_PER_PERIOD = 3;
export const PLUS_SHIELDS_CAP = 5;

export const webhookRoutes = new Hono<AppContext>().post("/revenuecat", async (c) => {
  const { db, env } = c.get("deps");
  const secret = env.REVENUECAT_WEBHOOK_SECRET;
  const auth = c.req.header("authorization") ?? "";
  if (!secret) {
    // An UNSET secret and a WRONG secret both 401, and RevenueCat retries
    // both the same way — so a deployment that simply forgot the secret looks
    // exactly like an attacker probing, while every real purchase silently
    // grants nothing. Observability is on for this Worker; say which it is.
    console.error("revenuecat webhook: REVENUECAT_WEBHOOK_SECRET is not set — every purchase event is being rejected");
    return c.json({ error: "unauthorized" }, 401);
  }
  if (auth !== `Bearer ${secret}`) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = EventSchema.safeParse((body as { event?: unknown } | null)?.event);
  if (!parsed.success) return c.json({ ok: true, ignored: "malformed" });
  const evt = parsed.data;

  const marker = await db.insert(schema.webhookEvents).values({ id: evt.id }).onConflictDoNothing().returning();
  if (marker.length === 0) return c.json({ ok: true, ignored: "duplicate" });

  if (!UUID_REGEX.test(evt.app_user_id)) return c.json({ ok: true, ignored: "non-uuid app_user_id" });
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
      // Omit expiresAt entirely when the event doesn't carry one (some RENEWAL payloads don't) —
      // writing null would wipe a known expiry instead of preserving it.
      const set: { plusActive: true; updatedAt: Date; expiresAt?: Date; shieldsRemaining?: ReturnType<typeof sql> } = {
        plusActive: true,
        updatedAt: new Date(),
      };
      if (evt.expiration_at_ms) set.expiresAt = new Date(evt.expiration_at_ms);
      if (SHIELD_GRANTING.includes(evt.type)) {
        // +3 paid shields per billing period, capped at 5 total (design spec §5 / paywall.creed-3).
        set.shieldsRemaining = sql`LEAST(${schema.entitlements.shieldsRemaining} + ${PLUS_SHIELDS_PER_PERIOD}, ${PLUS_SHIELDS_CAP})`;
      }
      await db.update(schema.entitlements).set(set).where(eq(schema.entitlements.userId, userId));
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
