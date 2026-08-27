// Action executors for the Hermes pipeline (spec §2, §6). Each function is a
// thin, single-purpose DB mutation (+ occasional telegram alert); runTick
// (./index.ts) is the only caller and owns try/catch + the executed-action
// labels. neon-http has no transactions — every write here is a standalone
// statement, safe to retry on the next tick if a later step in the same
// action fails.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import { addDays, noonET } from "./clock";
import { resolveQuestion } from "../resolution";
import { settleRound } from "../settlement";
import type { TelegramClient } from "./telegram";

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
  const locksAt = noonET(addDays(date, 1));
  await db
    .update(schema.questions)
    .set({ opensAt, locksAt, status: "open" })
    .where(and(eq(schema.questions.roundDate, date), eq(schema.questions.status, "scheduled")));
  await db.update(schema.rounds).set({ status: "open" }).where(eq(schema.rounds.date, date));
  return true;
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
    await resolveQuestion(db, row.id, "void", {
      unverifiable: true,
      checked_at: nowIso,
      reason: "unverifiable by 13:00 ET",
    });
  }

  await telegram.send(`⚠ voided unresolved questions (unverifiable by 13:00 ET):\n${texts.map((t) => `- ${t}`).join("\n")}`);
}

export async function settle(deps: { db: Db; telegram: TelegramClient }, date: string): Promise<void> {
  const result = await settleRound(deps.db, date);
  const qs = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (questions, { asc }) => [asc(questions.slot)],
  });

  const lines = qs.map((q) => `${q.slot}. ${q.text} → ${q.outcome ? q.outcome.toUpperCase() : "?"}`);
  const report = [
    `Round ${date} settled`,
    ...lines,
    `settled: ${result.settled}`,
    "reply if any outcome looks wrong",
  ].join("\n");

  await deps.telegram.send(report);
}
