import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import type { AppContext } from "../app";
import { resolveQuestion, withdrawQuestion } from "../resolution";
import { settleRound, resettleRound } from "../settlement";
import { schema } from "../db/client";
import { DraftSchema, RESOLVES_AFTER_LOCK, upsertDraft, FAST_ROUND_ERRORS } from "../pipeline/draft";
import { publish } from "../pipeline/actions";
import { stampOracleForecast } from "../pipeline/forecast";
import { commitLine } from "../pipeline/line";
import { makeTelegramClient } from "../pipeline/telegram";
import { runTick } from "../pipeline";
import { roundKindOf } from "../pipeline/round-kind";
import type { WorkflowInstanceBinding } from "../pipeline/workflows";

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

const WORKFLOW_KINDS = { author: "AUTHORING_WORKFLOW", resolve: "RESOLUTION_WORKFLOW", council: "COUNCIL_WORKFLOW" } as const;

// Resolves a :kind param to its binding, or explains why not. Two distinct
// failure modes get two distinct statuses: a kind outside {author, resolve,
// council} will NEVER exist, so it's a 400 — the request itself is wrong. A
// known kind whose binding is absent is a deployment missing its Workflow
// bindings (spec: they're optional at runtime); that's a 503 — the request
// is right, the server just isn't configured for it yet.
function bindingFor(
  c: Context<AppContext>,
  kind: string,
): { binding: WorkflowInstanceBinding } | { error: string; status: 400 | 503 } {
  const key = WORKFLOW_KINDS[kind as keyof typeof WORKFLOW_KINDS];
  if (!key) return { error: "unknown workflow kind", status: 400 };
  const binding = c.get("deps").workflows?.[key];
  if (!binding) return { error: "workflow binding not configured", status: 503 };
  return { binding };
}

export const adminRoutes = new Hono<AppContext>()
  .use("*", async (c, next) => {
    if (c.req.header("x-admin-secret") !== c.get("deps").env.ADMIN_SECRET) return c.json({ error: "unauthorized" }, 401);
    await next();
  })
  .post("/questions/:id/resolve", async (c) => {
    const parsed = ResolveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const db = c.get("deps").db;
    let alreadySettled = 0;
    try {
      ({ alreadySettled } = await resolveQuestion(db, c.req.param("id"), parsed.data.outcome, parsed.data.evidence ?? null, { force: parsed.data.force === true }));
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
    // Overturning a question rescores points and Briers but moves no money:
    // payFortune claims WHERE settled_at IS NULL, so stakes paid under the
    // first outcome stay paid. Say it, rather than leave the operator to
    // infer that the payouts followed the flip.
    if (alreadySettled > 0) {
      return c.json({
        ok: true,
        rescored,
        fortune_revised: false,
        note: `${alreadySettled} stake${alreadySettled === 1 ? " was" : "s were"} already paid under the previous outcome; fortune is not revised by a re-resolution`,
      });
    }
    return c.json({ ok: true, rescored });
  })
  // Honest withdrawal (design 2026-09-09 §1.4): an operator strikes a live
  // question with a TRUE reason. Every prediction on it zeroes exactly the
  // way any other void does.
  .post("/questions/:id/withdraw", async (c) => {
    const parsed = z.object({ reason: z.enum(["misauthored", "unresolvable"]) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    try {
      const out = await withdrawQuestion(c.get("deps").db, c.req.param("id"), parsed.data.reason, new Date());
      return c.json({ ok: true, remaining: out.remaining });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "withdraw failed";
      if (msg === "question not found") return c.json({ error: msg }, 404);
      if (msg === "already withdrawn" || msg === "not withdrawable") return c.json({ error: msg }, 409);
      return c.json({ error: "withdraw failed" }, 500);
    }
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
    // Which rules the seeded round plays by. upsertDraft's own default is 1
    // and this route never overrode it, so every hand-seeded round was legacy
    // — and a legacy reveal has no duel, which is the app's whole premise. The
    // default stays 1 so nothing already posting drafts shifts underneath
    // itself; v2 is opt-in, and brings the full-window rule with it.
    const rv = c.req.query("rules_version");
    if (rv !== undefined && rv !== "1" && rv !== "2") return c.json({ error: "rules_version must be 1 or 2" }, 400);
    const rulesVersion = rv === "2" ? 2 : 1;
    try {
      await upsertDraft(c.get("deps").db, c.req.param("date"), parsed.data, rulesVersion);
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "upsert failed";
      if (msg === "round not editable") return c.json({ error: msg }, 409);
      const BAD_DRAFT = new Set([
        "resolves_at out of range",
        "weather must lock before noon",
        "new rounds require the full common answering window",
        FAST_ROUND_ERRORS.pastVoidDeadline,
        FAST_ROUND_ERRORS.slowNotBigOne,
      ]);
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
    const ids = questions.map((q) => q.id);
    const [lineRows, evidenceRows] = ids.length
      ? await Promise.all([
          db.query.lines.findMany({ where: inArray(schema.lines.questionId, ids), columns: { questionId: true } }),
          db.query.evidence.findMany({ where: inArray(schema.evidence.questionId, ids), columns: { questionId: true } }),
        ])
      : [[], []];
    const countBy = (rows: { questionId: string }[], id: string) => rows.filter((r) => r.questionId === id).length;
    return c.json({
      round: { date: round.date, status: round.status },
      questions: questions.map((q) => ({ id: q.id, slot: q.slot, status: q.status, text: q.text, category: q.category, outcome: q.outcome, lines: countBy(lineRows, q.id), evidence: countBy(evidenceRows, q.id) })),
    });
  })
  // Author a round for a named date, through the same market round the cron runs.
  //
  // decideActions only ever authors TOMORROW, and only in the 17:00 ET window
  // — so there was no way to ask for a specific date. The gap mattered: the
  // only other way to seed a round is POST /admin/rounds/:date, and that goes
  // through upsertDraft at rules_version 1, which renders the legacy reveal
  // with no duel. This dispatches the real thing (fetchCandidates →
  // buildMarketDraft → commitMarketDraft), so a hand-triggered round is
  // indistinguishable from a scheduled one.
  //
  // Refuses a date that already has a round rather than clobbering it: the
  // market round ends in upsertDraft, which would throw "round not editable"
  // deep inside a Workflow where the caller never sees it.
  .post("/rounds/:date/author", async (c) => {
    const pipeline = c.get("deps").pipeline;
    if (!pipeline) return c.json({ error: "pipeline not configured" }, 503);
    const date = c.req.param("date");
    // A one-off kind (design 2026-09-22 §8): ?kind=opinion or ?kind=market
    // wins over PIPELINE_ROUND_KIND for this dispatch only.
    const kind = c.req.query("kind");
    if (kind !== undefined && kind !== "opinion" && kind !== "market") return c.json({ error: "unknown round kind" }, 400);
    const existing = await c.get("deps").db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    if (existing) return c.json({ error: "round already exists" }, 409);
    await pipeline.workflows.start(pipeline, "author", `author-${date}-manual-${Date.now()}`, { date, roundKind: kind ?? roundKindOf(pipeline) });
    return c.json({ ok: true, date });
  })
  // Stamp the Oracle's forecast for a date, by hand.
  //
  // decideActions gives this exactly one automatic window — hour 9..11 with
  // minute < 10 — and stampOracleForecast refuses once the round has opened,
  // because a machine that forecasts a round players can already see is not
  // forecasting. A round seeded outside that window therefore had no way to
  // ever get a commitment, and played out as a v2 round whose reveal says
  // "No complete Oracle forecast": scored, but with no duel, which is the
  // premise the whole app is built on.
  //
  // Idempotent, because stampOracleForecast returns early on an already
  // committed round — so this is safe to run without first knowing whether
  // the cron got there.
  .post("/rounds/:date/forecast", async (c) => {
    const pipeline = c.get("deps").pipeline;
    if (!pipeline) return c.json({ error: "pipeline not configured" }, 503);
    const date = c.req.param("date");
    const round = await c.get("deps").db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    if (!round) return c.json({ error: "unknown round" }, 404);
    try {
      await stampOracleForecast(pipeline, date);
      return c.json({ ok: true, date });
    } catch (e) {
      // Every refusal here is a statement about the round's state — already
      // open, deadline passed, no client, wrong slots — and the caller can act
      // on all of them. A 500 would say only that something went wrong.
      return c.json({ error: e instanceof Error ? e.message : "forecast failed" }, 409);
    }
  })
  .post("/rounds/:date/line", async (c) => {
    const { db } = c.get("deps");
    const r = await commitLine(db, c.req.param("date"));
    return c.json(r);
  })
  // Sit the Council for a date, by hand (design 2026-09-11 §4.1). Same
  // dispatch the cron uses; a manual id so it never collides with the hour's.
  .post("/rounds/:date/council", async (c) => {
    const pipeline = c.get("deps").pipeline;
    if (!pipeline) return c.json({ error: "pipeline not configured" }, 503);
    const date = c.req.param("date");
    const round = await c.get("deps").db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    if (!round) return c.json({ error: "unknown round" }, 404);
    if (round.rulesVersion < 3) return c.json({ error: "not a version 3 round" }, 409);
    if (round.oracleCommittedAt !== null) return c.json({ error: "already committed" }, 409);
    const id = `council-${date}-manual-${Date.now()}`;
    await pipeline.workflows.start(pipeline, "council", id, { date });
    return c.json({ ok: true, date, id });
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
  // Memory is readable and cuttable by hand (design 2026-09-11 §8): a bad
  // lesson found here is deleted here, and the next commit never sees it.
  .get("/lessons", async (c) => {
    const db = c.get("deps").db;
    const member = c.req.query("member");
    const series = c.req.query("series");
    const rows = await db.query.lessons.findMany({
      where: and(...(member ? [eq(schema.lessons.member, member)] : []), ...(series ? [eq(schema.lessons.seriesKey, series)] : [])),
      orderBy: (l, { desc }) => [desc(l.resolvedAt)],
      limit: 100,
    });
    return c.json({ lessons: rows.map((l) => ({ id: l.id, member: l.member, series_key: l.seriesKey, question_id: l.questionId, text: l.text, resolved_at: l.resolvedAt.toISOString(), created_at: l.createdAt.toISOString() })) });
  })
  .delete("/lessons/:id", async (c) => {
    const rows = await c.get("deps").db.delete(schema.lessons).where(eq(schema.lessons.id, c.req.param("id"))).returning({ id: schema.lessons.id });
    if (rows.length === 0) return c.json({ error: "unknown lesson" }, 404);
    return c.json({ ok: true });
  })
  .get("/workflows/:kind/:id", async (c) => {
    const resolved = bindingFor(c, c.req.param("kind"));
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status);
    const instance = await resolved.binding.get(c.req.param("id"));
    return c.json(await instance.status());
  })
  // The operational lever this whole design exists to make possible: a
  // resolution that died on question four is resumed AT question four, with
  // the first three steps served from cache (design 2026-09-08 §6).
  .post("/workflows/:kind/:id/restart", async (c) => {
    const resolved = bindingFor(c, c.req.param("kind"));
    if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status);
    const body = await c.req.json().catch(() => ({}));
    // A string `from` names the step to resume at; anything else restarts
    // from the top, matching restart()'s own no-argument default.
    const from = typeof body?.from === "string" ? { from: { name: body.from } } : undefined;
    const instance = await resolved.binding.get(c.req.param("id"));
    await instance.restart(from);
    return c.json({ ok: true });
  });
