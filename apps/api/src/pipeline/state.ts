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

// How often a locked question with no exchange behind it goes back to the
// model resolver after the noon hour. An exchange read costs nothing and stays
// hourly; a model attempt is a searched call on two models, and on Sept 9 the
// hourly retries of one unverifiable bank round were most of the day's calls.
// Four hours leaves six model attempts before the noon void. An ops threshold.
export const MODEL_RESOLVE_EVERY_HOURS = 4;

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
  openRound: {
    date: string;
    lockPassed: boolean;
    needsForecast: boolean;
    rulesVersion: number;
  } | null; // status='open'; lockPassed = now >= questions' locksAt
  lockedRound: { date: string; unresolvedIds: string[]; modelIds: string[] } | null; // status='locked'; modelIds ⊆ unresolvedIds have no exchange behind them
  scheduledDates: string[]; // rounds with status='scheduled'
  bankCount: number; // unused evergreen drafts (draft_bank.used_on IS NULL)
  // Whether runTick has a Claude client at all (deps.claude !== null). Not
  // derived from the DB — passed in from the caller, because decideActions
  // stays pure over (ETNow, PipelineState) with no I/O of its own (spec §9),
  // and this is exactly the same kind of external fact bankCount already is.
  claudeAvailable: boolean;
}

export async function loadPipelineState(db: Db, now: Date, claudeAvailable: boolean): Promise<PipelineState> {
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
      // Retained for missing-forecast alerts; open rounds are never retried.
      needsForecast: questions.some((q) => q.oracleProbYes === null),
      rulesVersion: openRoundRow.rulesVersion,
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
    lockedRound = {
      date: lockedRoundRow.date,
      unresolvedIds: unresolved.map((q) => q.id),
      modelIds: unresolved.filter((q) => !q.marketSource).map((q) => q.id),
    };
  }

  return {
    openRound,
    lockedRound,
    scheduledDates: scheduledRounds.map((r) => r.date),
    bankCount: Number(bankRow[0]?.n ?? 0),
    claudeAvailable,
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

  // FORECAST — today's scheduled draft only, from 09:00 until noon ET.
  // Hourly retries stop before players can see the round. The stamp action
  // skips an already committed draft before calling the model.
  if (
    state.scheduledDates.includes(today) &&
    hour >= 9 &&
    hour < 12 &&
    state.claudeAvailable &&
    minute < 10
  ) {
    actions.push({ kind: "forecast", date: today });
  }

  // PUBLISH — noon or later, even if the pre-open forecast is missing.
  // Today has a draft, and no still-open round blocking it
  // (the round we just decided to lock above no longer blocks, since it locks first).
  const openBlocksPublish = state.openRound !== null && !state.openRound.lockPassed;
  if (hour >= 12 && state.scheduledDates.includes(today) && !openBlocksPublish) {
    actions.push({ kind: "publish", date: today });
  }

  // PUBLISH FROM THE BANK — noon with nothing scheduled for today: the drop
  // must never depend on the author having been awake (design spec §6).
  // A noon bank fallback has no pre-open Oracle commitment and gets no duel.
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
  // §8): a question gets a full day of retries before it voids — every
  // question in the noon hour, then exchange reads hourly and the model
  // resolver every MODEL_RESOLVE_EVERY_HOURS.
  if (state.lockedRound) {
    const { date: lockedDate, unresolvedIds, modelIds } = state.lockedRound;
    if (unresolvedIds.length > 0) {
      const voidDay = addDays(lockedDate, 2); // locked at noon D+1 → voids at noon D+2
      const pastGrace = today > voidDay || (today === voidDay && hour >= 12);
      if (pastGrace) {
        actions.push({ kind: "void", date: lockedDate, questionIds: unresolvedIds });
      } else if (hour === 12 || minute < 10) {
        const modelTurn = hour === 12 || hour % MODEL_RESOLVE_EVERY_HOURS === 0;
        const questionIds = modelTurn ? unresolvedIds : unresolvedIds.filter((id) => !modelIds.includes(id));
        if (questionIds.length > 0) actions.push({ kind: "resolve", date: lockedDate, questionIds });
      }
    } else {
      actions.push({ kind: "settle", date: lockedDate });
    }
  }

  // AUTHOR tomorrow — ONCE, at 17:00 (design 2026-09-10 §5). A failed night
  // is narrated by the run itself and by the 23:00 alert; the bank covers noon.
  if (!state.scheduledDates.includes(tomorrow) && hour === 17 && minute < 10) {
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
      message: `round ${state.lockedRound.date} still has unresolved questions — exchange reads hourly, the model every ${MODEL_RESOLVE_EVERY_HOURS} hours, voids at noon ${addDays(state.lockedRound.date, 2)}`,
    });
  }

  // Once a day, report the missing-client state behind a missed pre-open
  // forecast. An open round cannot recover a commitment. Shares the
  // 23:00 window with the no-draft-for-tomorrow alert — same "end of day,
  // still not right" posture.
  if (
    state.openRound &&
    !state.openRound.lockPassed &&
    state.openRound.needsForecast &&
    !state.claudeAvailable &&
    hour === 23 &&
    minute < 10
  ) {
    actions.push({
      kind: "alert",
      level: "warn",
      message: `the Oracle cannot take its position on ${state.openRound.date} — no Claude client configured`,
    });
  }

  return actions;
}
