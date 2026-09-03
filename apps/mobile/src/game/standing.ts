import { CONSTANTS, vigilMultiplier } from "@oracle/core";

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
// The weight stays unmentioned below SHIELD_MIN_STREAK: a vigil too short for
// a shield to defend is not yet a stake worth naming on the row.
export function vigilStat(streak: number): string {
  const days = `${streak} ${streak === 1 ? "DAY" : "DAYS"}`;
  if (streak < CONSTANTS.SHIELD_MIN_STREAK) return days;
  const m = vigilMultiplier(streak);
  return `${days} · ×${String(Number(m.toFixed(2)))}`;
}
