import { z } from "zod";
import { CONSTANTS } from "./constants";

export const ConfidenceSchema = z
  .number()
  .int()
  .min(CONSTANTS.CONFIDENCE_MIN)
  .max(CONSTANTS.CONFIDENCE_MAX)
  .refine((n) => (n - CONSTANTS.CONFIDENCE_MIN) % CONSTANTS.CONFIDENCE_STEP === 0, {
    message: "confidence must be on the 55-95 step-5 grid",
  });

export const PredictionSubmitSchema = z.object({
  question_id: z.string().uuid(),
  answer: z.boolean(),
  // Accepted and ignored (design 2026-09-14 §6.1): the build on the store
  // still sends one. The route writes FORTUNE.CONFIDENCE_FLAT.
  confidence: ConfidenceSchema.optional(),
  idempotency_key: z.string().min(1).max(128),
});
export type PredictionSubmit = z.infer<typeof PredictionSubmitSchema>;

export const CrowdSoFarSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string().uuid(),
      crowd_yes_pct: z.number().int().min(0).max(100),
      player_count: z.number().int().min(0),
    }),
  ),
});
export type CrowdSoFar = z.infer<typeof CrowdSoFarSchema>;

export const QuestionContextSchema = z.object({ text: z.string().min(1).max(240), asOf: z.iso.datetime({ offset: true }), sourceUrl: z.string().url() });

export const RoundTodaySchema = z.object({
  rules_version: z.number().int().min(1).max(3).default(1),
  date: z.string(),
  locks_at: z.string().nullable(),
  player_count: z.number().int(),
  fortune: z.number().int().nullable().default(null),
  house: z.object({ total: z.number().int(), last_delta: z.number().int().nullable() }).nullable().default(null),
  questions: z.array(
    z.object({
      id: z.string().uuid(),
      slot: z.number().int(),
      is_big_one: z.boolean(),
      text: z.string(),
      category: z.string(),
      source_name: z.string(),
      resolution_criteria: z.string(),
      context: QuestionContextSchema.nullable().optional(),
      locks_at: z.string(),
      // True only when the in-window probe pulled this lock forward because the
      // answer appeared. An AUTHORED early lock is false: both produce a lock
      // before noon, and only this one is the machine catching a leak live.
      lock_healed: z.boolean(),
      // Struck from the round for everyone (v2): either the probe healed a
      // leaked lock or the operator withdrew it. The client gates the
      // required set on THIS, not on lock_healed, which stays probe-only.
      struck: z.boolean().default(false),
      // The printable reason when struck; null otherwise. Rendered verbatim.
      struck_reason: z.string().nullable().default(null),
      line_p_yes: z.number().min(0).max(1).nullable().default(null),
    }),
  ),
});
export type RoundToday = z.infer<typeof RoundTodaySchema>;

export const RoundNextSchema = z.object({ date: z.string(), opens_at: z.string() });
export type RoundNext = z.infer<typeof RoundNextSchema>;

export const MineTodaySchema = z.object({
  double_question_id: z.string().uuid().nullable().default(null),
  predictions: z.array(
    z.object({
      question_id: z.string().uuid(),
      answer: z.boolean(),
      confidence: z.number().int(),
      // The crowd at the instant this player sealed, sealer included (design
      // 2026-09-09 §4.1). Null on rows that predate the column.
      crowd_yes_pct_at_seal: z.number().int().min(0).max(100).nullable().default(null),
      crowd_count_at_seal: z.number().int().min(0).nullable().default(null),
      // The frozen stake and whether the double sits on it (design 2026-09-14 §6.3).
      stake: z.number().int().nullable().default(null),
      doubled: z.boolean().default(false),
    }),
  ),
});
export type MineToday = z.infer<typeof MineTodaySchema>;

// The Council on the wire (design 2026-09-11 §13). Both arrays default to
// empty so an older server still parses.
export const CouncilEntrySchema = z.object({
  question_id: z.string().uuid(),
  member: z.enum(["sonnet", "opus", "haiku", "market"]),
  p_yes: z.number(),
  on_right_side: z.boolean().nullable(),
  reasoning: z.string().nullable(),
  cited: z.array(z.number().int()),
  lessons_received: z.number().int(),
});
export type CouncilEntry = z.infer<typeof CouncilEntrySchema>;
export const EvidenceItemSchema = z.object({
  question_id: z.string().uuid(),
  rank: z.number().int(),
  url: z.string(),
  title: z.string(),
  source: z.string(),
  published_at: z.string().nullable(),
  highlight: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const RevealSchema = z.object({
  rules_version: z.number().int().min(1).max(3).default(1),
  bonus_points: z.number().int().default(0),
  date: z.string(),
  day_points: z.number().int(),
  first_hour: z.boolean(),
  // What the gauntlet cost, in candidates (design 2026-09-04 §11.1). Zero for a
  // bank drop and for every round authored before migration 0007 — the client
  // withholds the line entirely at zero rather than claim a perfect night.
  candidates_written: z.number().int(),
  candidates_rejected: z.number().int(),
  // How heavily the vigil weighed this day, stamped at settlement. Null means
  // the day has not been weighed yet -- the client must withhold the number
  // rather than print a total that will change (see revealRows.pointsWithheld).
  vigil_mult: z.number().nullable(),
  delta: z.number().int().nullable().default(null),
  return: z.number().nullable().default(null),
  fortune_after: z.number().int().nullable().default(null),
  house_delta: z.number().int().nullable().default(null),
  // Non-null means this round busted the caller, at this fortune (design
  // 2026-09-14 §6.4). fortune_after then carries the same number.
  bust_fortune: z.number().int().nullable().default(null),
  council: z.array(CouncilEntrySchema).default([]),
  evidence: z.array(EvidenceItemSchema).default([]),
  questions: z.array(
    z.object({
      id: z.string().uuid(),
      slot: z.number().int(),
      text: z.string(),
      outcome: z.enum(["yes", "no", "void"]).nullable(),
      crowd_yes_pct: z.number().nullable(),
      // Distinct predictors on this question at resolution — null before it
      // resolves. The reveal reads the crowd only above the same floor the
      // round footer uses.
      crowd_count: z.number().int().nullable(),
      market_prob: z.number().nullable(),
      line_p_yes: z.number().nullable().default(null),
      my: z
        .object({
          answer: z.boolean(),
          confidence: z.number().int(),
          points: z.number().int().nullable(),
          brier: z.number().nullable(),
          // The crowd at the instant this player sealed, sealer included
          // (design 2026-09-09 §4.1). Null on rows that predate the column.
          crowd_yes_pct_at_seal: z.number().int().min(0).max(100).nullable().default(null),
          crowd_count_at_seal: z.number().int().min(0).nullable().default(null),
          stake: z.number().int().nullable().default(null),
          payout: z.number().int().nullable().default(null),
          delta: z.number().int().nullable().default(null),
          doubled: z.boolean().default(false),
        })
        .nullable(),
      source_name: z.string(),
      source_url: z.string().nullable(),
      evidence_quote: z.string().nullable(),
      evidence_url: z.string().nullable().optional(),
      void_reason: z.string().nullable(),
      oracle_p_yes: z.number().nullable(),
    }),
  ),
  ledger: z.object({
    settled: z.boolean(),
    streak: z.number().int(),
    calls_rated: z.number().int(),
    oracle_score: z.number().int().nullable(),
  }),
});
export type Reveal = z.infer<typeof RevealSchema>;

// One day's field, ranked. The day, not the record: no cold start, one round,
// exact (it is a result, not an estimate), and nothing purchasable in it.
// Every number here is RAW per-question points -- see the route for why.
export const RoundBoardSchema = z.object({
  date: z.string(),
  metric: z.enum(["points", "return"]).default("points"),
  // Players who completed the round -- answered every question it asked.
  field_size: z.number().int(),
  // The caller's own raw day. Null when they did not complete the round.
  your_points: z.number().int().nullable(),
  // 1-based; a tie shares the better (numerically lower) rank. Null when the
  // caller is unrated, and null for everyone while the field is below
  // BOARD_MIN_FIELD -- as are the two comparisons below it.
  your_rank: z.number().int().nullable(),
  best_points: z.number().int().nullable(),
  median_points: z.number().int().nullable(),
  your_return_bp: z.number().int().nullable().default(null),
  best_return_bp: z.number().int().nullable().default(null),
  median_return_bp: z.number().int().nullable().default(null),
  // The field as a room rather than a rank. Machine-assigned designations
  // only -- nothing a user typed reaches this array, which is what keeps the
  // board free of a moderation surface. Empty below BOARD_MIN_FIELD.
  rows: z.array(
    z.object({
      name: z.string(),
      points: z.number().int(),
      return_bp: z.number().int().nullable().default(null),
      rank: z.number().int(),
      is_you: z.boolean(),
      // The machine stands in the list on the same ladder as the rows
      // beside it: big-one weight in, first hour / vigil / bounty out.
      is_oracle: z.boolean(),
    }),
  ),
});
export type RoundBoard = z.infer<typeof RoundBoardSchema>;

// The all-time board (design §7, §8.3): every player who has settled at least
// one stake, ranked by fortune. Same floor and window as the daily board.
export const AllTimeBoardSchema = z.object({
  field_size: z.number().int(),
  // The caller's fortune. Null when the caller has never settled a stake.
  your_fortune: z.number().int().nullable(),
  your_rank: z.number().int().nullable(),
  best_fortune: z.number().int().nullable(),
  median_fortune: z.number().int().nullable(),
  rows: z.array(z.object({ name: z.string(), fortune: z.number().int(), rank: z.number().int(), is_you: z.boolean() })),
});
export type AllTimeBoard = z.infer<typeof AllTimeBoardSchema>;

// The open record (design 2026-09-11 §13). Public; nothing about any player.
export const StandingsSchema = z.object({
  as_of: z.string(),
  rounds: z.number().int(),
  questions: z.number().int(),
  rows: z.array(z.object({
    member: z.enum(["sonnet", "opus", "haiku", "market", "crowd"]),
    calls: z.number().int(),
    brier: z.number().nullable(),
    house_delta: z.number().int(),
  })),
});
export type Standings = z.infer<typeof StandingsSchema>;

export const SubmitResSchema = z.object({ id: z.string().uuid(), first_hour: z.boolean(), stake: z.number().int().nullable().default(null) });
export type SubmitRes = z.infer<typeof SubmitResSchema>;

// The double (design 2026-09-14 §6.2): one per round, on one of the caller's
// own sealed calls, before that question's lock.
export const DoubleSubmitSchema = z.object({ question_id: z.string().uuid() });
export type DoubleSubmit = z.infer<typeof DoubleSubmitSchema>;
export const DoubleResSchema = z.object({ question_id: z.string().uuid(), stake: z.number().int(), wins: z.number().int() });
export type DoubleRes = z.infer<typeof DoubleResSchema>;

export const ConfidenceBucketSchema = z.object({
  confidence: ConfidenceSchema,
  total: z.number().int().positive(),
  correct: z.number().int().nonnegative(),
}).refine(bucket => bucket.correct <= bucket.total, { message: "correct must not exceed total" });

export const ConfidenceHistorySchema = z.object({
  scope: z.literal("lifetime_resolved"),
  min_bucket_calls: z.literal(20),
  buckets: z.array(ConfidenceBucketSchema).refine(
    buckets => buckets.every((bucket, index) => index === 0 || buckets[index - 1]!.confidence < bucket.confidence),
    { message: "confidence buckets must be unique and sorted ascending" },
  ),
});

export const MeLedgerSchema = z.object({
  confidence_history: ConfidenceHistorySchema.optional(),
  milestones: z.array(z.enum(["first_round", "first_result", "first_oracle_win", "three_rounds", "seven_rounds"])).default([]),
  // The player's reading round (design 2026-09-09 §2.2, §3.1): the latest
  // locked-or-settled round they answered, with how much of it is decided.
  // Null until they have answered a round that has locked. Defaulted so a
  // client ahead of the server still parses.
  reading: z
    .object({ date: z.string(), settled: z.boolean(), decided: z.number().int().min(0), total: z.number().int().min(0) })
    .nullable()
    .default(null),
  oracle_score: z.number().int().nullable(),
  // Where this record stands among every written Oracle Score. Null until the
  // caller's own score exists AND the cohort is worth comparing against.
  percentile: z.number().int().nullable(),
  cohort_size: z.number().int(),
  calls_rated: z.number().int(),
  calls_answered: z.number().int(),
  days_consulted: z.number().int(),
  streak: z.number().int(),
  accuracy_pct: z.number().int().nullable(),
  avg_confidence: z.number().int().nullable(),
  tide_wins: z.number().int(),
  majority_rate: z.number().nullable(),
  free_shield_available: z.boolean(),
  paid_shields: z.number().int().min(0),
  shield_used_on: z.string().nullable(),
  claimed: z.boolean(),
  epithet: z.object({ id: z.string(), title: z.string(), receipt: z.string() }),
  computed_through: z.string(),
  // THE ORACLE's own record, on the same fifty-call floor the player meets --
  // so for the first ten days the machine reads UNWRITTEN beside them.
  oracle: z.object({
    score: z.number().int().nullable(),
    calls_rated: z.number().int(),
    // Complete rounds in which the player got more calls right than the
    // machine did, and how many complete rounds were compared at all.
    days_outseen: z.number().int(),
    days_compared: z.number().int(),
  }),
  fortune: z.number().int().nullable().default(null),
  // The run (design 2026-09-14 §6.5): the highest fortune ever reached, and
  // the first date of the current run (null for the founding run).
  best_fortune: z.number().int().nullable().default(null),
  run_started_on: z.string().nullable().default(null),
  fortune_history: z.array(z.object({ date: z.string(), delta: z.number().int(), fortune_after: z.number().int() })).default([]),
  // The purse, so home can print the house headline without an open round
  // (design §8.3). Same shape as /today's `house`. Defaulted for older servers.
  house: z.object({ total: z.number().int(), last_delta: z.number().int().nullable() }).nullable().default(null),
});
export type MeLedger = z.infer<typeof MeLedgerSchema>;
