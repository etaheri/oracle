// Action executors for the Hermes pipeline (spec §2, §6). Each function is a
// thin, single-purpose DB mutation (+ occasional telegram alert); runTick
// (./index.ts) is the only caller and owns try/catch + the executed-action
// labels. neon-http has no transactions — every write here is a standalone
// statement, safe to retry on the next tick if a later step in the same
// action fails.
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { PIPELINE_LINES } from "@oracle/core";
import { schema, type Db } from "../db/client";
import { addDays, noonET } from "./clock";
import { resolveQuestion } from "../resolution";
import { settleRound } from "../settlement";
import { DraftSchema, upsertDraft } from "./draft";
import { crowdDrift, lateEdge, leakReport, loadLeakRows } from "./leak";
import { loadQualityRows, qualityReport, questionQuality } from "./quality";
import type { TelegramClient } from "./telegram";
import { composeHingePushes } from "../push/compose";
import { sendPushes, type PushEnv } from "../push/onesignal";

export async function lock(db: Db, date: string): Promise<void> {
  await db
    .update(schema.questions)
    .set({ status: "locked" })
    .where(and(eq(schema.questions.roundDate, date), eq(schema.questions.status, "open")));
  await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, date));
}

// Two-open guard (spec §2): publish must never run while another round is
// still open. decideActions already keeps this from firing in the normal
// case (openBlocksPublish); this is the belt-and-suspenders check against
// the live DB right before the write. Returns whether publish actually ran,
// so runTick only labels it "executed" when it did.
export async function publish(db: Db, telegram: TelegramClient, date: string): Promise<boolean> {
  const openRound = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "open") });
  if (openRound) {
    await telegram.send(`⚠ publish skipped for ${date}: round ${openRound.date} is still open`);
    return false;
  }

  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));
  const scheduled = await db.query.questions.findMany({
    where: and(eq(schema.questions.roundDate, date), eq(schema.questions.status, "scheduled")),
  });
  const publishingRound = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if ((publishingRound?.rulesVersion ?? 1) >= 2 && scheduled.some(q => q.locksAt.getTime() < locksAtDefault.getTime())) throw new Error("new rounds require the full common answering window");
  if (scheduled.some(q => q.context && Date.parse(q.context.asOf) > opensAt.getTime())) throw new Error("context must predate publication");
  for (const q of scheduled) {
    // Keep an authored early lock; anything else (incl. epoch-seeded test
    // rows) gets the default noon D+1 lock.
    const early = q.locksAt.getTime() > opensAt.getTime() && q.locksAt.getTime() < locksAtDefault.getTime();
    await db
      .update(schema.questions)
      .set({ opensAt, locksAt: early ? q.locksAt : locksAtDefault, status: "open" })
      .where(eq(schema.questions.id, q.id));
  }
  await db.update(schema.rounds).set({ status: "open" }).where(eq(schema.rounds.date, date));
  return true;
}

// The evergreen drop (spec §6): noon with nothing authored falls through to
// the oldest unused bank entry, so the round never depends on the agent
// being alive. An entry that fails DraftSchema (bank contents predate a
// schema change, or were hand-inserted wrong) is poisoned — marked used on
// this date without ever publishing.
//
// A poisoned entry used to end the call: one bad row burned the whole tick,
// so a bank of N stale rows (all persisted before some schema change) burns
// itself out over N ticks, ten minutes apart, while the noon drop silently
// produces nothing that day — on the one path whose entire purpose is to
// never fail. So this tries past poisoned entries within the same call,
// bounded so a wholly-corrupt bank can't spin the loop forever.
const MAX_BANK_ATTEMPTS = 5;

export async function publishFromBank(db: Db, telegram: TelegramClient, date: string): Promise<boolean> {
  // Belt-and-suspenders against decideActions' state snapshot going stale
  // (spec §2): a round for this date — locked, resolved, whatever status —
  // means someone already got here first. Bail before ever touching the
  // bank, so no telegram noise and no evergreen entry gets burned on a date
  // that doesn't need one.
  const existing = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (existing) return false;

  for (let attempt = 0; attempt < MAX_BANK_ATTEMPTS; attempt++) {
    const entry = await db.query.draftBank.findFirst({
      where: isNull(schema.draftBank.usedOn),
      orderBy: [asc(schema.draftBank.createdAt)],
    });
    if (!entry) return false;

    const parsed = DraftSchema.safeParse(entry.draft);
    if (!parsed.success) {
      await db.update(schema.draftBank).set({ usedOn: date }).where(eq(schema.draftBank.id, entry.id));
      await telegram.send(`⚠ bank draft ${entry.id} failed validation and was skipped`);
      continue;
    }

    // upsertDraft throws too — "resolves_at out of range" for an entry whose
    // instant is now in the past, or "weather must lock before noon". Those
    // throws used to escape the loop entirely, so the row was never marked
    // used and jammed every subsequent tick, on the one path whose whole
    // purpose is that the drop never fails. Poisoned is poisoned however it
    // is discovered: burn the row and try the next one.
    try {
      await upsertDraft(db, date, parsed.data, 2);
    } catch (err) {
      await db.update(schema.draftBank).set({ usedOn: date }).where(eq(schema.draftBank.id, entry.id));
      await telegram.send(`⚠ bank draft ${entry.id} could not be scheduled and was skipped: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    await db.update(schema.draftBank).set({ usedOn: date }).where(eq(schema.draftBank.id, entry.id));
    const ok = await publish(db, telegram, date);
    if (ok) {
      const [left] = await db.select({ n: count() }).from(schema.draftBank).where(isNull(schema.draftBank.usedOn));
      await telegram.send(`⚠ round ${date} published from the evergreen bank (${Number(left?.n ?? 0)} left)`);
    }
    return ok;
  }
  return false;
}

export async function voidQuestions(
  db: Db,
  telegram: TelegramClient,
  ids: string[],
  nowIso: string,
): Promise<void> {
  // Re-fetch right before voiding: a concurrent tick's in-flight resolve
  // (resolve.ts:resolveWithClaude) may have already resolved one of these
  // questions since decideActions snapshotted its status as "locked". Only
  // void questions that are still locked, so a late-arriving resolve never
  // gets stomped by a stale void.
  const rows = await db.query.questions.findMany({ where: inArray(schema.questions.id, ids) });
  const stillLocked = rows.filter((r) => r.status === "locked");
  if (stillLocked.length === 0) return;

  const texts = stillLocked.map((r) => r.text);

  for (const row of stillLocked) {
    // A question two independent readers could not agree on is not the same
    // event as one nobody could read at all, and the reveal renders void_reason
    // verbatim. Reading the flag the last resolve attempt wrote is the only way
    // that distinction survives to void time (design 2026-09-04 §11.3).
    const ev = row.resolutionEvidence as { disagreement?: unknown } | null;
    const struck = ev !== null && typeof ev === "object" && ev.disagreement === true;
    await resolveQuestion(db, row.id, "void", {
      unverifiable: true,
      checked_at: nowIso,
      reason: struck ? PIPELINE_LINES.voidDisagreement : "unverifiable within 24 hours of lock",
    });
  }

  await telegram.send(`⚠ voided unresolved questions (unverifiable within 24 hours of lock):\n${texts.map((t) => `- ${t}`).join("\n")}`);
}

export async function settle(deps: { db: Db; telegram: TelegramClient; push?: PushEnv }, date: string): Promise<void> {
  const result = await settleRound(deps.db, date);

  // The hinge push (voice spec §4 beat 3): the day's second dopamine hit,
  // fired the moment the ledger is actually readable. It composes AFTER
  // settleRound because the audience is settleRound's own stamp and the
  // vigil lines quote the streak it just wrote. Best-effort in both
  // directions — a push failure must never leave a settled round unnarrated,
  // and with no OneSignal keys the whole thing no-ops and says so.
  let pushLine = "push: not configured";
  try {
    const pushes = await composeHingePushes(deps.db, date);
    const { sent, skipped } = await sendPushes(deps.push ?? {}, pushes);
    pushLine = `push: ${sent} sent, ${skipped} skipped (${pushes.length} composed)`;
  } catch (err) {
    pushLine = `push: FAILED — ${err instanceof Error ? err.message : String(err)}`;
  }

  const qs = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (questions, { asc }) => [asc(questions.slot)],
  });

  const defaultLocksAt = noonET(addDays(date, 1));
  const leakLines = await Promise.all(
    qs.map(async (q) => {
      const rows = await loadLeakRows(deps.db, q.id);
      return { slot: q.slot, drift: crowdDrift(rows), edge: lateEdge(rows), locksAt: q.locksAt };
    }),
  );

  // LEAK WATCH asks whether today's questions stayed answerable after their
  // answers existed. This asks the other half: whether they were worth
  // answering at all. One day is too small a sample for either, so the
  // scorecard reads the trailing window, not this round.
  const quality = qualityReport(questionQuality(await loadQualityRows(deps.db, date)));

  const lines = qs.map((q) => `${q.slot}. ${q.text} → ${q.outcome ? q.outcome.toUpperCase() : "?"}`);
  const report = [
    `Round ${date} settled`,
    ...lines,
    `settled: ${result.settled}`,
    pushLine,
    "",
    ...leakReport(leakLines, defaultLocksAt),
    "",
    ...quality,
    "",
    "reply if any outcome looks wrong",
  ].join("\n");

  await deps.telegram.send(report);
}
