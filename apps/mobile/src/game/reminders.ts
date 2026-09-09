import { COPY_BANK, selectLine } from "@oracle/core";

// The closing call (voice spec §4 beat 2), planned on-device: one local
// notification per day, three hours before that day's lock. Future locks are
// assumed 24h apart — a DST shift drifts them by an hour until the next app
// open reseals the schedule. Pure — node-tested; expo scheduling lives in
// src/notifications/schedule.ts.
const CLOSING = COPY_BANK.filter((l) => l.pool === "closing" && !(l.requires ?? []).includes("players"));
// The second hit (voice spec §4 beat 3): a single noon reminder, fired once
// something was sealed today — true whether or not resolution has finished,
// so the line never claims more than the ledger actually knows yet.
const NOON_LINE = "RETURN TO OUTSEEN TO CHECK YOUR PREDICTIONS AND THE NEXT CHALLENGE.";

export const REMINDER_LEAD_MS = 3 * 3_600_000;
export const NOON_LAG_MS = 45 * 60_000;
export const REMINDER_DAYS = 7;
const HABIT_WINDOW_MS = 86_400_000;
const HABIT_TAIL_MS = 30 * 60_000;

export interface Reminder { kind: "closing" | "noon"; date: string; at: Date; body: string }

// A device's habitual hour (design 2026-09-09 §4.2): the closing reminder
// for round k moves into [lock_k − 24h, lock_k − 30min] if a top-of-hour
// instant there matches the hour this device usually plays; otherwise the
// plain lead time stands. localHourOf is injected so this stays pure.
export interface Habit { hour: number; localHourOf: (ms: number) => number }

// Scans hourly from the start of the window; the first instant whose local
// hour matches is snapped to the top of that hour (UTC minutes, which is
// also local minutes for any whole-hour-offset timezone) before use. The
// snap can shift the local hour when the lock itself isn't hour-aligned
// (an early v1 lock) combined with a fractional-offset timezone (IST,
// Newfoundland), so the hour is re-checked after snapping — a mismatch
// falls through to the next sample. The default lead time is reachable
// only when no whole hour in the window survives that re-check: a DST
// spring-forward, or a non-hour-aligned lock in a fractional-offset zone.
function habitualInstant(lockMs: number, habit: Habit): Date | null {
  const start = lockMs - HABIT_WINDOW_MS;
  const end = lockMs - HABIT_TAIL_MS;
  for (let t = start; t <= end; t += 3_600_000) {
    if (habit.localHourOf(t) !== habit.hour) continue;
    const snapped = new Date(t);
    snapped.setUTCMinutes(0, 0, 0);
    if (snapped.getTime() < start || snapped.getTime() > end) continue;
    if (habit.localHourOf(snapped.getTime()) !== habit.hour) continue;
    return snapped;
  }
  return null;
}

export function planReminders(locksAt: string, roundDate: string, sealedCount: number, total = 5, habit?: Habit | null): Reminder[] {
  const lock0 = new Date(locksAt).getTime();
  const day0 = new Date(`${roundDate}T00:00:00Z`).getTime();
  const out: Reminder[] = [];
  // The second hit: once anything is sealed today, the ledger's reading is worth a knock.
  if (sealedCount > 0) out.push({ kind: "noon", date: roundDate, at: new Date(lock0 + NOON_LAG_MS), body: NOON_LINE });
  for (let k = 0; k < REMINDER_DAYS; k++) {
    if (k === 0 && sealedCount >= total) continue;
    const date = new Date(day0 + k * 86_400_000).toISOString().slice(0, 10);
    const partial = k === 0 && sealedCount > 0;
    const pool = partial ? CLOSING.filter((l) => (l.requires ?? []).includes("partial")) : CLOSING;
    const line = selectLine(pool, `closing:${date}`, partial ? ["partial"] : []);
    if (!line) continue;
    const lockK = lock0 + k * 86_400_000;
    const at = (habit && habitualInstant(lockK, habit)) ?? new Date(lockK - REMINDER_LEAD_MS);
    out.push({ kind: "closing", date, at, body: line.text });
  }
  return out;
}
