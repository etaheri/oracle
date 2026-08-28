import { COPY_BANK, selectLine } from "@oracle/core";

// The closing call (voice spec §4 beat 2), planned on-device: one local
// notification per day, three hours before that day's lock. Future locks are
// assumed 24h apart — a DST shift drifts them by an hour until the next app
// open reseals the schedule. Pure — node-tested; expo scheduling lives in
// src/notifications/schedule.ts.
const CLOSING = COPY_BANK.filter((l) => l.pool === "closing");

export const REMINDER_LEAD_MS = 3 * 3_600_000;
export const REMINDER_DAYS = 7;

export interface Reminder { date: string; at: Date; body: string }

export function planReminders(locksAt: string, roundDate: string, todaySealed: boolean): Reminder[] {
  const lock0 = new Date(locksAt).getTime();
  const day0 = new Date(`${roundDate}T00:00:00Z`).getTime();
  const out: Reminder[] = [];
  for (let k = 0; k < REMINDER_DAYS; k++) {
    if (k === 0 && todaySealed) continue;
    const date = new Date(day0 + k * 86_400_000).toISOString().slice(0, 10);
    // satisfied=[] → only requirement-free lines are eligible; the oracle
    // does not change its mind, so the seed is the date alone.
    const line = selectLine(CLOSING, `closing:${date}`, []);
    if (!line) continue;
    out.push({ date, at: new Date(lock0 + k * 86_400_000 - REMINDER_LEAD_MS), body: line.text });
  }
  return out;
}
