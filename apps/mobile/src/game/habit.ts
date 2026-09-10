export interface SealHour { date: string; hour: number } // local calendar date, local hour 0–23

export const HABIT_MIN_DAYS = 3;
export const HABIT_KEEP = 14;

// When this device shows up (design 2026-09-09 §4.2): the median local hour
// of the first seal on each of the last HABIT_KEEP days. Pure; the store is
// flags.ts, the scheduler is notifications/schedule.ts.
export function habitualHour(history: ReadonlyArray<SealHour>): number | null {
  const byDate = new Map<string, number>();
  for (const e of history) if (!byDate.has(e.date)) byDate.set(e.date, e.hour);
  if (byDate.size < HABIT_MIN_DAYS) return null;
  const hours = [...byDate.values()].sort((a, b) => a - b);
  return hours[Math.floor((hours.length - 1) / 2)]!;
}

// Records at most one entry per calendar date (first seal of the day wins)
// and keeps only the newest HABIT_KEEP dates. Returns the SAME array
// reference when the date already exists, so a caller can skip a write
// that would change nothing (recordSealHour in api/flags.ts).
export function withSealHour(history: ReadonlyArray<SealHour>, entry: SealHour): SealHour[] {
  if (history.some((e) => e.date === entry.date)) return history as SealHour[];
  return [...history, entry].slice(-HABIT_KEEP);
}
