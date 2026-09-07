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
  confidence: ConfidenceSchema,
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
  rules_version: z.number().int().min(1).max(2).default(1),
  date: z.string(),
  locks_at: z.string().nullable(),
  player_count: z.number().int(),
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
    }),
  ),
});
export type RoundToday = z.infer<typeof RoundTodaySchema>;

export const RoundNextSchema = z.object({ date: z.string(), opens_at: z.string() });
export type RoundNext = z.infer<typeof RoundNextSchema>;

export const MineTodaySchema = z.object({
  predictions: z.array(
    z.object({
      question_id: z.string().uuid(),
      answer: z.boolean(),
      confidence: z.number().int(),
    }),
  ),
});
export type MineToday = z.infer<typeof MineTodaySchema>;

export const RevealSchema = z.object({
  rules_version: z.number().int().min(1).max(2).default(1),
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
      my: z
        .object({
          answer: z.boolean(),
          confidence: z.number().int(),
          points: z.number().int().nullable(),
          brier: z.number().nullable(),
        })
        .nullable(),
      source_name: z.string(),
      source_url: z.string().nullable(),
      evidence_quote: z.string().nullable(),
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
  // The field as a room rather than a rank. Machine-assigned designations
  // only -- nothing a user typed reaches this array, which is what keeps the
  // board free of a moderation surface. Empty below BOARD_MIN_FIELD.
  rows: z.array(
    z.object({
      name: z.string(),
      points: z.number().int(),
      rank: z.number().int(),
      is_you: z.boolean(),
      // The machine stands in the list on the same ladder as the rows
      // beside it: big-one weight in, first hour / vigil / bounty out.
      is_oracle: z.boolean(),
    }),
  ),
});
export type RoundBoard = z.infer<typeof RoundBoardSchema>;

export const SubmitResSchema = z.object({ id: z.string().uuid(), first_hour: z.boolean() });
export type SubmitRes = z.infer<typeof SubmitResSchema>;

export const MeLedgerSchema = z.object({
  milestones: z.array(z.enum(["first_round", "first_result", "first_oracle_win", "three_rounds", "seven_rounds"])).default([]),
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
});
export type MeLedger = z.infer<typeof MeLedgerSchema>;
