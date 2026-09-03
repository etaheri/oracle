// Hermes pipeline decision core (spec §2, §9). loadPipelineState reads the DB
// into a plain snapshot; decideActions is a pure function of ET wall-clock +
// that snapshot — no Date.now, no I/O, so the cron's every-tick decisions are
// fully testable and replayable.
import { and, count, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import { addDays, type ETNow } from "./clock";

// How deep the evergreen buffer has to be before the pipeline stops topping it
// up. An ops threshold, not a game rule — it belongs here and not in
// @oracle/core, whose header says "Scoring/game tunables". Five entries is
// five days of drops with no author alive at all.
export const BANK_LOW_WATER = 5;

export type Action =
  | { kind: "lock"; date: string }
  | { kind: "publish"; date: string }
  | { kind: "publish-bank"; date: string }
  | { kind: "resolve"; date: string; questionIds: string[] }
  | { kind: "void"; date: string; questionIds: string[] }
  | { kind: "settle"; date: string }
  | { kind: "author"; date: string }
  | { kind: "author-bank" }
  | { kind: "forecast"; date: string }
  | { kind: "alert"; level: "warn" | "critical"; message: string };

export interface PipelineState {
  openRound: { date: string; lockPassed: boolean; needsForecast: boolean } | null; // status='open'; lockPassed = now >= questions' locksAt
  lockedRound: { date: string; unresolvedIds: string[] } | null; // status='locked'
  scheduledDates: string[]; // rounds with status='scheduled'
  bankCount: number; // unused evergreen drafts (draft_bank.used_on IS NULL)
}

export async function loadPipelineState(db: Db, now: Date): Promise<PipelineState> {
  const [openRoundRow, lockedRoundRow, scheduledRounds, bankRow] = await Promise.all([
    db.query.rounds.findFirst({ where: eq(schema.rounds.status, "open") }),
    db.query.rounds.findFirst({
      where: eq(schema.rounds.status, "locked"),
      orderBy: (rounds, { asc }) => [asc(rounds.date)],
    }),
    db.query.rounds.findMany({ where: eq(schema.rounds.status, "scheduled") }),
    db.select({ n: count() }).from(schema.draftBank).where(isNull(schema.draftBank.usedOn)),
  ]);

  let openRound: PipelineState["openRound"] = null;
  if (openRoundRow) {
    const questions = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, openRoundRow.date),
    });
    const maxLocksAt = questions.reduce(
      (max, q) => (q.locksAt.getTime() > max ? q.locksAt.getTime() : max),
      0,
    );
    openRound = {
      date: openRoundRow.date,
      lockPassed: now.getTime() >= maxLocksAt,
      // The Oracle owes this round a position on every question. Recomputed
      // from the rows each tick, so a partial stamp simply retries.
      needsForecast: questions.some((q) => q.oracleProbYes === null),
    };
  }

  let lockedRound: PipelineState["lockedRound"] = null;
  if (lockedRoundRow) {
    const unresolved = await db.query.questions.findMany({
      where: and(
        eq(schema.questions.roundDate, lockedRoundRow.date),
        eq(schema.questions.status, "locked"),
      ),
      orderBy: (questions, { asc }) => [asc(questions.slot)],
    });
    lockedRound = { date: lockedRoundRow.date, unresolvedIds: unresolved.map((q) => q.id) };
  }

  return {
    openRound,
    lockedRound,
    scheduledDates: scheduledRounds.map((r) => r.date),
    bankCount: Number(bankRow[0]?.n ?? 0),
  };
}

export function decideActions(now: ETNow, state: PipelineState): Action[] {
  const actions: Action[] = [];
  const { date: today, hour, minute } = now;
  const tomorrow = addDays(today, 1);

  // LOCK
  if (state.openRound?.lockPassed) {
    actions.push({ kind: "lock", date: state.openRound.date });
  }

  // FORECAST — the Oracle owes the open round a position, and takes it
  // before the answers exist. Hourly throttle (minute<10) like authoring:
  // the call makes chained web searches and a failure simply retries.
  // Never past the lock: at that point a forecast would be a look-up.
  if (state.openRound && !state.openRound.lockPassed && state.openRound.needsForecast && minute < 10) {
    actions.push({ kind: "forecast", date: state.openRound.date });
  }

  // PUBLISH — noon or later, today has a draft, and no still-open round blocking it
  // (the round we just decided to lock above no longer blocks, since it locks first).
  const openBlocksPublish = state.openRound !== null && !state.openRound.lockPassed;
  if (hour >= 12 && state.scheduledDates.includes(today) && !openBlocksPublish) {
    actions.push({ kind: "publish", date: today });
  }

  // PUBLISH FROM THE BANK — noon with nothing scheduled for today: the drop
  // must never depend on the author having been awake (design spec §6).
  if (
    hour >= 12 &&
    !state.scheduledDates.includes(today) &&
    !openBlocksPublish &&
    state.openRound?.date !== today &&
    state.lockedRound?.date !== today &&
    state.bankCount > 0
  ) {
    actions.push({ kind: "publish-bank", date: today });
  }

  // RESOLVE / VOID / SETTLE on the locked round. Late, never wrong (design
  // §8): a question gets a full day of hourly retries before it voids.
  if (state.lockedRound) {
    const { date: lockedDate, unresolvedIds } = state.lockedRound;
    if (unresolvedIds.length > 0) {
      const voidDay = addDays(lockedDate, 2); // locked at noon D+1 → voids at noon D+2
      const pastGrace = today > voidDay || (today === voidDay && hour >= 12);
      if (pastGrace) {
        actions.push({ kind: "void", date: lockedDate, questionIds: unresolvedIds });
      } else if (hour === 12 || minute < 10) {
        actions.push({ kind: "resolve", date: lockedDate, questionIds: unresolvedIds });
      }
    } else {
      actions.push({ kind: "settle", date: lockedDate });
    }
  }

  // AUTHOR tomorrow — hourly throttle at minute<10
  if (!state.scheduledDates.includes(tomorrow) && hour >= 17 && minute < 10) {
    actions.push({ kind: "author", date: tomorrow });
  }

  // REFILL THE BANK — one entry per firing, at 03:00 only: off-peak, at most
  // once a day, and well clear of both the 17:00 authoring window and the noon
  // drop. The bank refills over days, which is the point of a low-water mark:
  // the buffer is what absorbs the wait.
  if (state.bankCount < BANK_LOW_WATER && hour === 3 && minute < 10) {
    actions.push({ kind: "author-bank" });
  }

  // ALERTS — each throttled to one tick per hour by minute window
  const tomorrowUnauthored = !state.scheduledDates.includes(tomorrow);
  if (hour >= 23 && minute < 10 && tomorrowUnauthored) {
    actions.push(
      state.bankCount > 0
        ? {
            kind: "alert",
            level: "warn",
            message: `no draft for tomorrow — the bank covers noon (${state.bankCount} left)`,
          }
        : {
            kind: "alert",
            level: "critical",
            message: `no draft for tomorrow — seed manually: POST /admin/rounds/${tomorrow}`,
          },
    );
  }

  // The buffer behind tomorrow, which is a different fact from tomorrow
  // itself: the drop can be covered tonight and the bank still be two nights
  // from empty. Suppressed only when the empty-bank critical above already
  // said the same thing in stronger words.
  if (
    hour >= 23 &&
    minute < 10 &&
    state.bankCount < BANK_LOW_WATER &&
    !(state.bankCount === 0 && tomorrowUnauthored)
  ) {
    actions.push({
      kind: "alert",
      level: "warn",
      message: `the evergreen bank is low — ${state.bankCount} of ${BANK_LOW_WATER}, refilling one a night at 03:00`,
    });
  }

  if (
    hour >= 12 &&
    minute >= 10 &&
    minute < 20 &&
    !state.scheduledDates.includes(today) &&
    state.openRound?.date !== today &&
    state.bankCount === 0
  ) {
    actions.push({
      kind: "alert",
      level: "critical",
      message: `no round published for today — POST /admin/rounds/${today}/publish (or seed a draft first)`,
    });
  }

  if (
    state.lockedRound &&
    state.lockedRound.unresolvedIds.length > 0 &&
    hour >= 13 &&
    minute >= 30 &&
    minute < 40
  ) {
    actions.push({
      kind: "alert",
      level: "warn",
      message: `round ${state.lockedRound.date} still has unresolved questions — retrying hourly, voids at noon ${addDays(state.lockedRound.date, 2)}`,
    });
  }

  return actions;
}
