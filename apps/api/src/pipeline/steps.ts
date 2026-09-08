// Step policy, in one place (design 2026-09-08 §4.2).
//
// THE DEFAULT IS NEVER INHERITED. Cloudflare's default step config is
// `{ retries: { limit: 5, delay: 10s, backoff: exponential }, timeout: "10 minutes" }`,
// and that inherited 10 minutes is the whole of defect §1.1: a single step
// wrapping five sequential resolves re-created the cap the Workflow substrate
// was adopted to escape.
//
// Policies are named after the KIND of work rather than the step that uses
// them, so two steps doing the same kind of work cannot drift apart, and a new
// step has to CHOOSE a policy rather than invent one.
//
// This file is plain TypeScript on purpose — it imports nothing from
// "cloudflare:workers", so the policies are assertable in the PGlite suite.
export interface StepPolicy {
  timeout: string;
  retries: { limit: number; delay: string; backoff?: "exponential" | "linear" | "constant" };
}

export const POLICY = {
  /** DB reads plus keyless HTTP feeds. Cheap, safe to repeat. */
  context: { timeout: "2 minutes", retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },

  /** One model call with web search. The common case. */
  model: { timeout: "8 minutes", retries: { limit: 2, delay: "20 seconds", backoff: "exponential" } },

  /**
   * One model call inside an N-wide fan-out. Shallower than `model` because
   * the limit multiplies by the fan-out width: 12 candidates at limit 1 is 24
   * calls worst case, against a 150/day ceiling (spec §4.5).
   */
  modelWide: { timeout: "8 minutes", retries: { limit: 1, delay: "20 seconds", backoff: "exponential" } },

  /** N parallel GETs, each already capped at SOURCE_TIMEOUT_MS internally. */
  sourceFetch: { timeout: "2 minutes", retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } },

  /** Deterministic compute. Retried only to survive an engine restart. */
  pure: { timeout: "1 minute", retries: { limit: 3, delay: "1 second", backoff: "constant" } },

  /** Idempotent writes — upserts and fixed-value updates. */
  db: { timeout: "2 minutes", retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },

  /** Terminal narration. Best-effort, never load-bearing (spec §5.2). */
  narrate: { timeout: "1 minute", retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },

  /**
   * The taste gate (spec §5.1). Zero retries so the fail-closed guarantee is
   * DECLARED rather than emergent — tasteCheck catches internally today, but a
   * future edit that let an error escape must not silently gain a retry.
   */
  failClosed: { timeout: "5 minutes", retries: { limit: 0, delay: "1 second" } },

  /**
   * Resolve and probe model steps (spec §4.1). The hourly cron re-dispatch IS
   * their retry layer, and it is already scoped per question by the DB, so an
   * inner retry buys nothing an outer one does not — it only multiplies.
   */
  noRetry: { timeout: "9 minutes", retries: { limit: 0, delay: "1 second" } },
} as const satisfies Record<string, StepPolicy>;
