import { Hono } from "hono";
import { z } from "zod";
import { eq, asc, gte } from "drizzle-orm";
import type { AppContext } from "../app";
import { resolveQuestion } from "../resolution";
import { settleRound, resettleRound } from "../settlement";
import { schema } from "../db/client";
import { DraftSchema, RESOLVES_AFTER_LOCK, upsertDraft } from "../pipeline/draft";
import { publish } from "../pipeline/actions";
import { makeTelegramClient } from "../pipeline/telegram";
import { runTick } from "../pipeline";
import { pooledLeak, loadLeakRows, type SealRow } from "../pipeline/leak";

const ResolveSchema = z.object({ outcome: z.enum(["yes", "no", "void"]), evidence: z.unknown().optional(), force: z.boolean().optional() });

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
    const db = c.get("deps").db;
    try {
      await resolveQuestion(db, c.req.param("id"), parsed.data.outcome, parsed.data.evidence ?? null, { force: parsed.data.force === true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "resolve failed";
      if (msg === "not resolvable") return c.json({ error: msg }, 409);
      if (msg === "question not found") return c.json({ error: msg }, 404);
      return c.json({ error: "resolve failed" }, 500);
    }
    let rescored = 0;
    if (parsed.data.force) {
      const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, c.req.param("id")) });
      if (q) rescored = (await resettleRound(db, q.roundDate)).users;
    }
    return c.json({ ok: true, rescored });
  })
  .patch("/questions/:id", async (c) => {
    const parsed = PatchQuestionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const db = c.get("deps").db;
    const question = await db.query.questions.findFirst({ where: eq(schema.questions.id, c.req.param("id")) });
    if (!question) return c.json({ error: "unknown question" }, 404);
    if (question.status !== "scheduled") return c.json({ error: "not editable" }, 409);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, question.roundDate) });
    if (round?.oracleCommittedAt) return c.json({ error: "Oracle forecast already committed" }, 409);

    const patch: Partial<typeof schema.questions.$inferInsert> = {};
    if (parsed.data.text !== undefined) patch.text = parsed.data.text;
    if (parsed.data.resolution_criteria !== undefined) patch.resolutionCriteria = parsed.data.resolution_criteria;
    if (parsed.data.source_name !== undefined) patch.sourceName = parsed.data.source_name;
    if (parsed.data.source_url !== undefined) patch.sourceUrl = parsed.data.source_url;

    try {
      await db.update(schema.questions).set(patch).where(eq(schema.questions.id, question.id));
    } catch (error) {
      // A forecast may have committed after the initial read. The database
      // preserves the question; surface that conflict rather than a 500.
      const latest = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, question.roundDate) });
      if (latest?.oracleCommittedAt) return c.json({ error: "Oracle forecast already committed" }, 409);
      throw error;
    }
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
      const BAD_DRAFT = new Set(["resolves_at out of range", "weather must lock before noon"]);
      if (BAD_DRAFT.has(msg)) return c.json({ error: msg }, 400);
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
  })
  .post("/bank", async (c) => {
    const parsed = DraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    // Bank drafts publish on an unknown future date, so an absolute instant
    // would be stale. Every question must be "after-lock" — which also means
    // no weather in the bank (the schema forbids weather from after-lock).
    if (parsed.data.questions.some((q) => q.resolves_at !== RESOLVES_AFTER_LOCK)) {
      return c.json({ error: "bank drafts must resolve after the lock" }, 400);
    }
    const [row] = await c.get("deps").db.insert(schema.draftBank).values({ draft: parsed.data }).returning({ id: schema.draftBank.id });
    return c.json({ id: row!.id }, 201);
  })
  .get("/bank", async (c) => {
    const rows = await c.get("deps").db.query.draftBank.findMany({ orderBy: (b, { asc }) => [asc(b.createdAt)] });
    return c.json({
      available: rows.filter((r) => r.usedOn === null).length,
      drafts: rows.map((r) => ({ id: r.id, created_at: r.createdAt.toISOString(), used_on: r.usedOn })),
    });
  })
  // The window's leak, across every round rather than one at a time. The
  // settle-time LEAK WATCH answers "did this question leak"; this answers
  // "does the window leak", which is the one that decides whether a standing
  // ranks foresight or patience.
  .get("/analytics/leak", async (c) => {
    const db = c.get("deps").db;
    const since = c.req.query("since");
    const rounds = await db.query.rounds.findMany({
      where: since ? gte(schema.rounds.date, since) : undefined,
      orderBy: [asc(schema.rounds.date)],
    });

    const perRound: Array<{ date: string; drift: number | null; edge: number | null; seals: number; questions: number }> = [];
    const everyQuestion: SealRow[][] = [];

    for (const r of rounds) {
      const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, r.date) });
      const rowsPerQuestion = await Promise.all(qs.map((q) => loadLeakRows(db, q.id)));
      everyQuestion.push(...rowsPerQuestion);
      const p = pooledLeak(rowsPerQuestion);
      perRound.push({ date: r.date, drift: p.drift, edge: p.edge, seals: p.seals, questions: p.questions });
    }

    return c.json({
      pooled: pooledLeak(everyQuestion),
      rounds: perRound,
      // Stated in the payload, not only in leak.ts's header, so whoever reads
      // this JSON gets it without reading the source.
      caveat:
        "DRIFT AND EDGE MEASURE DRIFT, NOT PROVEN LEAKAGE. HONEST NEWS CONVERGES A CROWD TOO, " +
        "AND THE FIRST-HOUR BONUS SELECTS ENGAGED PLAYERS INTO THE EARLY HALF, BIASING EDGE NEGATIVE. " +
        "A QUIET REPORT IS THE ABSENCE OF A SYMPTOM, NOT AN ALL-CLEAR.",
    });
  });
