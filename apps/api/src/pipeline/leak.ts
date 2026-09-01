// Leak telemetry (audit 2026-09-01 §1.3c). The window fix is unverifiable
// without it: these three numbers are how we find out whether a question
// stayed answerable after its answer existed. predictions.created_at has been
// stored since the beginning; nothing ever read it.
import { eq } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import { etNow } from "./clock";

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

// The default lock ("locks noon") is always noon ET by construction
// (defaultLocksAt = noonET(...)); an early lock is a real instant that must
// read in the same zone, or the one column an operator scans to compare lock
// times mixes UTC and ET side by side (review finding, minor 5).
const stampET = (d: Date) => {
  const { date, hour, minute } = etNow(d);
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}ET`;
};

// The legend lives on the header line, not buried in a comment only the
// author reads — this is the only artifact that tells anyone whether the
// window-integrity pass actually worked, and it has to be readable cold
// (review finding, important 2).
const HEADER =
  "LEAK WATCH — drift: crowd swing, first quartile of sealers to last, in points; " +
  "late edge: earlier-half mean brier minus later-half — positive means late sealers scored better, i.e. the leak";

export function leakReport(
  lines: Array<{ slot: number; drift: number | null; edge: number | null; locksAt: Date }>,
  defaultLocksAt: Date,
): string[] {
  const body = lines.map((l) => {
    const lock = l.locksAt.getTime() < defaultLocksAt.getTime() ? `locks ${stampET(l.locksAt)}` : "locks noon ET";
    // A voided question can gather plenty of seals (drift is computable)
    // while carrying zero rated briers (edge is not) — the two metrics are
    // independent and must render independently, or a real drift signal
    // gets swallowed behind an unrelated missing edge (review finding,
    // important 1). Only render the terse combined line when BOTH are
    // absent; otherwise show each metric on its own terms.
    if (l.drift === null && l.edge === null) return `${l.slot} too few seals · ${lock}`;
    const driftPart = l.drift === null ? "drift too few seals" : `drift ${l.drift}pp`;
    const edgePart = l.edge === null ? "late edge too few seals" : `late edge ${signed(l.edge)}`;
    return `${l.slot} ${driftPart} · ${edgePart} · ${lock}`;
  });
  return [HEADER, ...body, `early-lock rate ${earlyLockRate(lines, defaultLocksAt)}`];
}

export async function loadLeakRows(db: Db, questionId: string): Promise<SealRow[]> {
  const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, questionId) });
  // Postgres numeric can hold 'NaN'; that would pass a plain !== null check
  // and poison the mean in lateEdge. Treat it as unrated instead (review
  // finding, minor 4).
  const toBrier = (b: string | null): number | null => {
    if (b === null) return null;
    const n = Number(b);
    return Number.isFinite(n) ? n : null;
  };
  return rows.map((p) => ({ createdAt: p.createdAt, answer: p.answer, brier: toBrier(p.brier) }));
}
