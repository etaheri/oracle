import { vigilMultiplier } from "@oracle/core";

// Where this record stands among every written Oracle Score. The API withholds
// the percentile until the caller has a score AND the cohort is worth
// comparing against, so a null here means "not yet", never "last".
//
// A THIRD, NOT A NUMBER. Simulating players whose skill drives both their side
// and their stated confidence, over questions drawn from the contested band
// this game actually asks (P(yes) in [0.3, 0.7]), a lifetime percentile at the
// shipped fifty-call floor carries +/-15 percentile points of MEDIAN error --
// and only ~30% of the observed top decile truly belong there. That narrowness
// is structural: constraining questions to [0.3, 0.7] is what makes the game
// worth playing and what makes Brier scores slow to separate people. So
// "SHARPER THAN 62%" was two digits of precision the measurement cannot carry,
// on the one row of an app whose whole brand is honesty about calibration.
//
// Thirds, and not finer. A quintile is a 20-point band sitting entirely inside
// +/-15 points of noise; a 33-point band survives it. Offering a finer band
// than the measurement supports is precisely the error this replaced -- if you
// are here to "improve" this to quintiles, the number you need is above.
//
// There is no floor case. `percentile <= 0` used to be spared with "ONE OF {n}
// SEALED RECORDS"; the lower third already says that, without singling anyone
// out and without a point estimate. This app does not otherwise flinch from an
// unflattering truth -- `calibrationVerdict` will tell a reader their
// confidence outruns their accuracy -- and it does not start here.
export function standingLine(percentile: number | null, cohortSize: number): string | null {
  if (percentile === null) return null;
  const band = percentile >= 67 ? "UPPER" : percentile >= 34 ? "MIDDLE" : "LOWER";
  return `THE ${band} THIRD OF ${cohortSize} SEALED RECORDS`;
}

// The vigil's row says what the vigil now does. A bare day count was honest
// when the streak was a pride number; it is not, now that it weighs the day.
// The weight is named whenever it EXISTS -- from the first day, where it is
// 1.05. Deliberately not gated on SHIELD_MIN_STREAK: that is the shield's
// floor, not the multiplier's, and tying the two would make this row report a
// weight of nothing the moment either constant moved.
export function vigilStat(streak: number): string {
  const days = `${streak} ${streak === 1 ? "DAY" : "DAYS"}`;
  const m = vigilMultiplier(streak);
  return m <= 1 ? days : `${days} · ×${String(Number(m.toFixed(2)))}`;
}
