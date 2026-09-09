import { CONSTANTS } from "@oracle/core";

// The mid-term goal, made visible: fifty rated calls write the Oracle Score.
//
// A stat-row VALUE, not a sentence. It used to end "QUALIFYING CALLS" and ran
// 36 characters, which wrapped the row and its label together into an
// interleaved four-fragment block on the plaque. Which calls qualify is the
// gloss's job, one row below, where it is stated in full.
export function scoreValue(oracleScore: number | null, callsRated: number): string {
  return oracleScore === null
    ? `UNWRITTEN · ${Math.min(callsRated, CONSTANTS.ORACLE_SCORE_MIN_CALLS)} OF ${CONSTANTS.ORACLE_SCORE_MIN_CALLS}`
    : String(oracleScore);
}
