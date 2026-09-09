import { inPlayLine, READING_LINES, type MeLedger } from "@oracle/core";

export type Reading = NonNullable<MeLedger["reading"]>;

export type ReadingSlot =
  | { kind: "none" }
  | { kind: "inPlay"; date: string; line: string; cta: string }
  | { kind: "settled"; date: string; line: string; cta: string };

// What the home call slot says about the reading round (design 2026-09-09
// §2.2, §3.1). Pure, so the home screen stays a renderer.
export function readingSlot(reading: Reading | null | undefined, revealSeen: string | null): ReadingSlot {
  if (!reading) return { kind: "none" };
  if (!reading.settled) {
    // Every question decided but the round not yet settled is a one-tick gap
    // (settle lands within one cron tick of the last resolve/void) — never
    // "0 PENDING" while still claiming to be IN PLAY. The rail still links.
    if (reading.decided < 1 || reading.decided >= reading.total) return { kind: "none" };
    return { kind: "inPlay", date: reading.date, line: inPlayLine(reading.decided, reading.total - reading.decided), cta: READING_LINES.inPlayCta };
  }
  if (revealSeen === reading.date) return { kind: "none" };
  return { kind: "settled", date: reading.date, line: READING_LINES.settled, cta: READING_LINES.settledCta };
}
