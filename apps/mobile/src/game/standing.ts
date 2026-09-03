import { vigilMultiplier } from "@oracle/core";

// Where this record stands among every written Oracle Score. The API withholds
// the percentile until the caller has a score AND the cohort is worth
// comparing against, so a null here means "not yet", never "last".
export function standingLine(percentile: number | null, cohortSize: number): string | null {
  if (percentile === null) return null;
  // Zero below is true and unkind, and it is also the least informative thing
  // the plaque could say. The number itself is already carved above this row.
  if (percentile <= 0) return `ONE OF ${cohortSize} SEALED RECORDS`;
  return `SHARPER THAN ${percentile}% OF ${cohortSize} SEALED RECORDS`;
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
