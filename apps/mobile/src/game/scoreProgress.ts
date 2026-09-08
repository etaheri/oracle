import { CONSTANTS } from "@oracle/core";

// The mid-term goal, made visible: fifty rated calls write the Oracle Score.
export function scoreValue(oracleScore: number | null, callsRated: number): string {
  return oracleScore === null
    ? `UNWRITTEN · ${Math.min(callsRated, CONSTANTS.ORACLE_SCORE_MIN_CALLS)} OF ${CONSTANTS.ORACLE_SCORE_MIN_CALLS} QUALIFYING CALLS`
    : String(oracleScore);
}
