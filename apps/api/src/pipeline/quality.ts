// Question-quality telemetry (design 2026-09-03 §6). Everything else in this
// app measures the players. Nothing measured the questions — and ranking
// people on uncontested questions makes any board a participation trophy, so
// this is upstream of the whole scoreboard.
//
// Three numbers, and the same caution `leak.ts` asks for. A run of one-sided
// outcomes moves `authorBrier` down without the author having written a
// single gimme: the metric is the author's calibration over the window, and
// over 140 questions that is a real signal, over 12 it is mostly the coin.
// `uncontestedRate` measures the crowd's agreement, not the truth — a crowd
// can be uncontested and wrong. Read the block as a drift alarm on the
// author's own standards, not as a grade.
import { and, gte, lte } from "drizzle-orm";
import { CONSTANTS as C } from "@oracle/core";
import { schema, type Db } from "../db/client";
import { addDays } from "./clock";

export interface QualityRow {
  outcome: "yes" | "no" | "void" | null;
  crowdYesPct: number | null;
  crowdCount: number | null;
  authorProb: number | null;
}

export interface QualityReport {
  n: number;
  voidRate: number | null;
  uncontestedRate: number | null;
  authorBrier: number | null;
}

// Where a crowd stops being split. A question the crowd landed on this hard
// asked nothing of anybody, whatever probability the author claimed for it.
const UNCONTESTED_PCT = 85;

// The window the settle report and the author's own scorecard both read.
export const QUALITY_WINDOW_DAYS = 28;

const isResolved = (r: QualityRow) => r.outcome === "yes" || r.outcome === "no";

const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * The window's three numbers, each computed over its own denominator.
 *
 * Every metric returns null rather than 0 when its denominator is empty. The
 * difference matters here more than most places: a void rate of 0 is a clean
 * month and a void rate of null is a month nobody asked anything in, and an
 * author brier of 0 would be the worst possible reading of a column that is
 * simply not populated yet. `leakReport` had to learn this the hard way.
 */
export function questionQuality(rows: QualityRow[]): QualityReport {
  const n = rows.length;

  const voided = rows.filter((r) => r.outcome === "void").length;

  // Only crowds that are actually crowds. A 100% split of two people is a
  // small sample, not a consensus — the same floor the contrarian bonus
  // judges the tide against, and the same bug the finale already had to fix.
  const judged = rows.filter(
    (r) =>
      isResolved(r) &&
      r.crowdYesPct !== null &&
      r.crowdCount !== null &&
      r.crowdCount >= C.CONTRARIAN_MIN_CROWD,
  );
  const oneWay = judged.filter(
    (r) => r.crowdYesPct! >= UNCONTESTED_PCT || r.crowdYesPct! <= 100 - UNCONTESTED_PCT,
  ).length;

  // Skips every row carrying no stated probability, which is every row asked
  // before the column existed.
  const scored = rows.filter((r) => isResolved(r) && r.authorProb !== null);

  return {
    n,
    voidRate: n === 0 ? null : voided / n,
    uncontestedRate: judged.length === 0 ? null : oneWay / judged.length,
    authorBrier: mean(scored.map((r) => (r.authorProb! - (r.outcome === "yes" ? 1 : 0)) ** 2)),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// The legend lives on the header line, not in a comment only the author of
// the comment reads. Both readers of this block — an operator scanning a
// settle report at 12:10, and the authoring model reading its own record —
// meet these numbers cold, and neither can act on "0.19" without being told
// which direction is bad. Same rule `leak.ts:HEADER` follows.
const HEADER =
  `QUESTION QUALITY — last ${QUALITY_WINDOW_DAYS} days. ` +
  `void: share of questions that could not be resolved at all; ` +
  `uncontested: resolved questions the crowd landed ${UNCONTESTED_PCT}%+ one way, counted only over crowds of ${C.CONTRARIAN_MIN_CROWD}+; ` +
  `author brier: mean squared error of the author's own stated probability — 0.25 is genuinely contested, well below it means gimmes dressed as coin flips`;

export function qualityReport(r: QualityReport): string[] {
  // Each metric renders on its own terms. A window can have a computable
  // void rate and no author brier at all, and a missing brier must not
  // swallow a void rate that is screaming.
  const voidPart = r.voidRate === null ? "void no questions yet" : `void ${pct(r.voidRate)}`;
  const unPart =
    r.uncontestedRate === null
      ? "uncontested no crowds above the floor"
      : `uncontested ${pct(r.uncontestedRate)}`;
  const brierPart =
    r.authorBrier === null ? "author brier no rated calls" : `author brier ${r.authorBrier.toFixed(3)}`;
  return [HEADER, `${r.n} asked · ${voidPart} · ${unPart} · ${brierPart}`];
}

// Postgres numeric arrives as a string and can hold 'NaN', which would pass a
// plain !== null check and poison a mean. Treat anything non-finite as
// unstated (the lesson loadLeakRows already carries).
const toNum = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Every question asked in the {@link QUALITY_WINDOW_DAYS} days ending on
 * `date`, inclusive of `date` itself — the round being settled is the one the
 * operator most wants counted.
 */
export async function loadQualityRows(db: Db, date: string): Promise<QualityRow[]> {
  const since = addDays(date, -(QUALITY_WINDOW_DAYS - 1));
  const rows = await db.query.questions.findMany({
    where: and(gte(schema.questions.roundDate, since), lte(schema.questions.roundDate, date)),
  });
  return rows.map((q) => ({
    outcome: q.outcome,
    crowdYesPct: toNum(q.crowdYesPct),
    crowdCount: q.crowdCount,
    authorProb: toNum(q.authorProb),
  }));
}
