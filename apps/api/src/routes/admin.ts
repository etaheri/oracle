import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppContext } from "../app";
import { resolveQuestion } from "../resolution";
import { settleRound } from "../settlement";
import { schema } from "../db/client";
import { DraftSchema, upsertDraft } from "../pipeline/draft";
import { publish } from "../pipeline/actions";
import { makeTelegramClient } from "../pipeline/telegram";
import { runTick } from "../pipeline";

const ResolveSchema = z.object({ outcome: z.enum(["yes", "no", "void"]), evidence: z.unknown().optional() });

const PatchQuestionSchema = z.object({
  text: z.string().min(10).optional(),
  resolution_criteria: z.string().min(10).optional(),
  source_name: z.string().min(1).optional(),
  source_url: z.string().url().optional(),
});

// No-op fallback so /rounds/:date/publish works even when the pipeline
// (telegram, claude, cron deps) isn't wired up — the publish executor still
// needs a TelegramClient to narrate a skip.
const noopTelegram = makeTelegramClient(undefined, undefined);

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
  .patch("/questions/:id", async (c) => {
    const parsed = PatchQuestionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const db = c.get("deps").db;
    const question = await db.query.questions.findFirst({ where: eq(schema.questions.id, c.req.param("id")) });
    if (!question) return c.json({ error: "unknown question" }, 404);
    if (question.status !== "scheduled") return c.json({ error: "not editable" }, 409);

    const patch: Partial<typeof schema.questions.$inferInsert> = {};
    if (parsed.data.text !== undefined) patch.text = parsed.data.text;
    if (parsed.data.resolution_criteria !== undefined) patch.resolutionCriteria = parsed.data.resolution_criteria;
    if (parsed.data.source_name !== undefined) patch.sourceName = parsed.data.source_name;
    if (parsed.data.source_url !== undefined) patch.sourceUrl = parsed.data.source_url;

    await db.update(schema.questions).set(patch).where(eq(schema.questions.id, question.id));
    return c.json({ ok: true });
  })
  .post("/rounds/:date", async (c) => {
    const parsed = DraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    try {
      await upsertDraft(c.get("deps").db, c.req.param("date"), parsed.data);
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "upsert failed";
      if (msg === "round not editable") return c.json({ error: msg }, 409);
      return c.json({ error: "upsert failed" }, 500);
    }
  })
  .get("/rounds/:date", async (c) => {
    const db = c.get("deps").db;
    const date = c.req.param("date");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    if (!round) return c.json({ error: "unknown round" }, 404);
    const questions = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, date),
      orderBy: (questions, { asc }) => [asc(questions.slot)],
    });
    return c.json({
      round: { date: round.date, status: round.status },
      questions: questions.map((q) => ({ id: q.id, slot: q.slot, status: q.status, text: q.text, category: q.category, outcome: q.outcome })),
    });
  })
  .post("/rounds/:date/publish", async (c) => {
    const db = c.get("deps").db;
    const date = c.req.param("date");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    if (!round) return c.json({ error: "unknown round" }, 404);
    if (round.status !== "scheduled") return c.json({ error: "not publishable" }, 409);

    const telegram = c.get("deps").pipeline?.telegram ?? noopTelegram;
    const published = await publish(db, telegram, date);
    if (!published) return c.json({ error: "not publishable" }, 409);
    return c.json({ ok: true });
  })
  .post("/rounds/:date/settle", async (c) => {
    try {
      const out = await settleRound(c.get("deps").db, c.req.param("date"));
      return c.json({ ok: true, ...out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "settle failed";
      if (msg === "unknown round") return c.json({ error: msg }, 404);
      if (msg === "not fully resolved") return c.json({ error: msg }, 409);
      return c.json({ error: "settle failed" }, 500);
    }
  })
  .post("/pipeline/tick", async (c) => {
    const pipeline = c.get("deps").pipeline;
    if (!pipeline) return c.json({ error: "pipeline not configured" }, 503);
    const executed = await runTick(pipeline);
    return c.json({ ok: true, executed });
  });
