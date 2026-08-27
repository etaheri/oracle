import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../app";
import { resolveQuestion } from "../resolution";
import { settleRound } from "../settlement";

const ResolveSchema = z.object({ outcome: z.enum(["yes", "no", "void"]), evidence: z.unknown().optional() });

export const adminRoutes = new Hono<AppContext>()
  .use("*", async (c, next) => {
    if (c.req.header("x-admin-secret") !== c.get("deps").env.ADMIN_SECRET) return c.json({ error: "unauthorized" }, 401);
    await next();
  })
  .post("/questions/:id/resolve", async (c) => {
    const parsed = ResolveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    await resolveQuestion(c.get("deps").db, c.req.param("id"), parsed.data.outcome, parsed.data.evidence ?? null);
    return c.json({ ok: true });
  })
  .post("/rounds/:date/settle", async (c) => {
    try {
      const out = await settleRound(c.get("deps").db, c.req.param("date"));
      return c.json({ ok: true, ...out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "settle failed";
      return c.json({ error: msg }, msg === "unknown round" ? 404 : 409);
    }
  });
