import type { MeLedger } from "@oracle/core";

// The record's two room rows and the verdict under them (design 2026-09-25
// §6.4). The comparison is the design's own: the days the caller read against
// the days the machines missed. Level says nothing.
export const ROOM_READ_LABEL = "READ THE ROOM";
export const ROOM_MISSED_LABEL = "THE MACHINES MISSED";

export function roomRows(room: MeLedger["room"] | undefined): { read: string; missed: string; verdict: string | null; gold: boolean } | null {
  if (!room || room.days === 0) return null;
  const ahead = room.days_read > room.days_machines_missed;
  const behind = room.days_read < room.days_machines_missed;
  return {
    read: `${room.days_read} OF ${room.days} ${room.days === 1 ? "DAY" : "DAYS"}`,
    missed: `${room.days_machines_missed} OF ${room.days}`,
    verdict: ahead ? "YOU READ THE ROOM BETTER THAN THE MACHINES" : behind ? "THE MACHINES READ IT BETTER" : null,
    gold: ahead,
  };
}
