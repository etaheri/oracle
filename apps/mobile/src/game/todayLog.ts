import type { LogLine, TodayLog } from "@oracle/core";

// The log route's payload, by question (design 2026-09-25 §6.2). A question
// the caller has not sealed is absent from the payload, so it is absent here:
// the round screen cannot print a channel, or price a double, for a take that
// has not been sealed.
export interface SealedLog { line: number | null; log: LogLine[] }

export function logIndex(data: TodayLog | null | undefined): Map<string, SealedLog> {
  return new Map((data?.questions ?? []).map((q) => [q.question_id, { line: q.line_p_yes, log: q.log }]));
}
