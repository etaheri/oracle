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

export interface Reminder { kind: "closing" | "noon"; date: string; at: Date; body: string }

export function planReminders(locksAt: string, roundDate: string, sealedCount: number, total = 5): Reminder[] {
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
    out.push({ kind: "closing", date, at: new Date(lock0 + k * 86_400_000 - REMINDER_LEAD_MS), body: line.text });
  }
  return out;
}
