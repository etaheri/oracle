/** Scoring/game tunables. ⚙ values may be tuned during TestFlight; properties are spec-fixed. */
export const CONSTANTS = {
  CONFIDENCE_MIN: 55,
  CONFIDENCE_MAX: 95,
  CONFIDENCE_STEP: 5,
  POINTS_SCALE: 200,    // points = round(mult × POINTS_SCALE × (POINTS_BASELINE − brier))
  POINTS_BASELINE: 0.25, // coin-flip brier — EV of a 50/50 guess is 0 points
  BIG_ONE_MULT: 2,      // applies to wins and losses
  CONTRARIAN_MULT: 2,   // wins only
  CONTRARIAN_CROWD_PCT: 40, // your side's final crowd % must be strictly below this
  FIRST_HOUR_BONUS: 0.10,   // +10% of the day's positive total
  ORACLE_SCORE_WINDOW: 100,
  ORACLE_SCORE_MIN_CALLS: 50,
  FORECAST_WEIGHT_PIVOT: 750,
  FORECAST_WEIGHT_SCALE: 60,
  FORECAST_EXTREMIZE_D: 1.5,
  FORECAST_MIN_RATED: 500,
} as const;
