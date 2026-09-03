/** Scoring/game tunables. ⚙ values may be tuned during TestFlight; properties are spec-fixed. */
export const CONSTANTS = {
  CONFIDENCE_MIN: 55,
  CONFIDENCE_MAX: 95,
  CONFIDENCE_STEP: 5,
  POINTS_SCALE: 200,    // points = round(mult × POINTS_SCALE × (POINTS_BASELINE − brier))
  POINTS_BASELINE: 0.25, // coin-flip brier — EV of a 50/50 guess is 0 points
  BIG_ONE_MULT: 2,      // applies to wins and losses
  CONTRARIAN_BONUS: 20,      // ADDITIVE, wins only, ×BIG_ONE_MULT on the big one — additive keeps the rule proper
  CONTRARIAN_MIN_CROWD: 20,  // no tide under this many players on the question
  CONTRARIAN_CROWD_PCT: 40,  // your side's final crowd % must be strictly below this
  SHIELD_MIN_STREAK: 3,      // shields (free or paid) only defend a vigil this long
  VERDICT_MIN_CALLS: 20,     // calibration verdict / gap epithets need this many resolved calls
  // The first hour weighs the day. ⚙ tunable.
  // SYMMETRIC BY LAW, on the vigil's terms: applied to losing days exactly as
  // to winning ones, through the same weighDay. It is fixed before any of
  // today's outcomes exist, so E[M·S] = M·E[S] and the honest report stays
  // optimal at every value -- there is no tuning ceiling. The wins-only shape
  // this replaced was convex at zero and broke properness at 0.11; see
  // scoring-day.test.ts's negative control, which keeps it from returning.
  FIRST_HOUR_BONUS: 0.10,
  // The vigil weighs the day. ⚙ tunable.
  // SYMMETRIC BY LAW: applied to losing days exactly as to winning ones. The
  // multiplier is fixed by the streak carried INTO the day, so it is a
  // positive constant with respect to today's reports and E[M·S] = M·E[S] --
  // the honest report stays optimal. A wins-only variant puts a convex kink
  // at zero and rewards overconfidence; see scoring-day.test.ts's negative
  // control, which exists to keep that variant from ever passing.
  VIGIL_MULT_PER_DAY: 0.05,
  VIGIL_MULT_MAX_DAYS: 10,
  ORACLE_SCORE_WINDOW: 100,
  ORACLE_SCORE_MIN_CALLS: 50,
  PERCENTILE_MIN_COHORT: 20,  // a percentile over eleven people is mostly the reader
  // The daily board says nothing comparative under this many complete rounds
  // -- a rank over three people is mostly the reader, the same posture the
  // crowd's own verdict floor takes. Below it the board still reports the
  // field's size; it just stops claiming a placing inside it.
  BOARD_MIN_FIELD: 5,
  // The board's window. Named here rather than as literals at the call site
  // because the reveal reserves height against them.
  BOARD_TOP_ROWS: 3,      // rows from the summit
  BOARD_NEIGHBOURS: 2,    // rows either side of the caller
  // Rows only -- the summary line is BOARD_MAX_LINES' job, and the reveal
  // reserves against the sum of the two. Worst case is the top rows, plus the
  // caller's own window (themselves and BOARD_NEIGHBOURS either side), plus
  // the Oracle pinned in from outside both.
  BOARD_ROWS_MAX: 9,      // BOARD_TOP_ROWS + (1 + 2*BOARD_NEIGHBOURS) + the pinned Oracle
} as const;
