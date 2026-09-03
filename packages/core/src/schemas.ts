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

export const RoundTodaySchema = z.object({
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
      locks_at: z.string(),
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
  date: z.string(),
  day_points: z.number().int(),
  first_hour: z.boolean(),
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

export const SubmitResSchema = z.object({ id: z.string().uuid(), first_hour: z.boolean() });
export type SubmitRes = z.infer<typeof SubmitResSchema>;

export const MeLedgerSchema = z.object({
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
});
export type MeLedger = z.infer<typeof MeLedgerSchema>;
