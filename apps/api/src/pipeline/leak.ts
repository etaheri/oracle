// Leak telemetry (audit 2026-09-01 §1.3c). The window fix is unverifiable
// without it: these three numbers are how we find out whether a question
// stayed answerable after its answer existed. predictions.created_at has been
// stored since the beginning; nothing ever read it.
import { eq } from "drizzle-orm";
import { schema, type Db } from "../db/client";

export interface SealRow { createdAt: Date; answer: boolean; brier: number | null }

// Quartiles of three are noise. Below this, every metric reports null.
const MIN_SEALS = 8;

const byTime = (rows: SealRow[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const yesPct = (rows: SealRow[]) => (100 * rows.filter((r) => r.answer).length) / rows.length;

/**
 * How far the crowd moved across the window: YES% among the first quartile of
 * sealers vs the last. A question whose crowd swung is a question that leaked.
 * Percentage points, rounded.
 */
export function crowdDrift(rows: SealRow[]): number | null {
  if (rows.length < MIN_SEALS) return null;
  const sorted = byTime(rows);
  const q = Math.floor(sorted.length / 4);
  return Math.round(Math.abs(yesPct(sorted.slice(-q)) - yesPct(sorted.slice(0, q))));
}

/**
 * Mean Brier of the earlier half minus the later half, over rated rows only.
 * Positive = the players who sealed late scored better, which is the leak
 * showing up directly in the scoreboard.
 */
export function lateEdge(rows: SealRow[]): number | null {
  const rated = byTime(rows).filter((r) => r.brier !== null);
  if (rated.length < MIN_SEALS) return null;
  const half = Math.floor(rated.length / 2);
  const mean = (xs: SealRow[]) => xs.reduce((a, r) => a + r.brier!, 0) / xs.length;
  return mean(rated.slice(0, half)) - mean(rated.slice(-half));
}

/** How many of the round's questions actually closed before the round did. */
export function earlyLockRate(qs: Array<{ locksAt: Date }>, defaultLocksAt: Date): string {
  const early = qs.filter((q) => q.locksAt.getTime() < defaultLocksAt.getTime()).length;
  return `${early}/${qs.length}`;
}

const signed = (n: number) => (n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3));
const stamp = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;

export function leakReport(
  lines: Array<{ slot: number; drift: number | null; edge: number | null; locksAt: Date }>,
  defaultLocksAt: Date,
): string[] {
  const body = lines.map((l) => {
    const lock = l.locksAt.getTime() < defaultLocksAt.getTime() ? `locks ${stamp(l.locksAt)}` : "locks noon";
    if (l.drift === null || l.edge === null) return `${l.slot} too few seals · ${lock}`;
    return `${l.slot} drift ${l.drift}pp · late edge ${signed(l.edge)} · ${lock}`;
  });
  return ["LEAK WATCH", ...body, `early-lock rate ${earlyLockRate(lines, defaultLocksAt)}`];
}

export async function loadLeakRows(db: Db, questionId: string): Promise<SealRow[]> {
  const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, questionId) });
  return rows.map((p) => ({ createdAt: p.createdAt, answer: p.answer, brier: p.brier === null ? null : Number(p.brier) }));
}
