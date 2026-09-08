# Oracle learning: implementation path

September 7, 2026. Architecture proposal, not an implemented learning system.

## Use the current stack

Keep the TypeScript Worker, Neon Postgres/Drizzle, existing Claude research client, Zod output validation, and Vitest/PGlite tests. Add a Cloudflare Workflow for evaluation when needed; the project already uses Workflows for authoring, resolution and probes. No agent framework or model training infrastructure is required to start.

The commitment fix adds immutable round metadata: database commit timestamp, model, prompt version, and the exact question/probability snapshot. Existing outcomes provide labels after resolution. This is an audit foundation, not evidence that the Oracle improves automatically. The source URL in this snapshot is the question source, not a complete archive of the forecaster's web research.

## Three small modules

1. `forecastRecord.ts`: persist each live and candidate run before opening. Extend structured research output to include a short rationale, cited sources with evidence excerpts, and the main uncertainty. Store the evidence actually used; current web-search response content is not preserved in full by the Claude adapter.
2. `evaluateForecasts.ts`: join finalized outcomes to recorded probabilities; compute Brier scores, confidence counts, coverage, and paired live/candidate differences. This is deterministic TypeScript and SQL, not an LLM judging itself.
3. `reviewForecasts.ts`: optionally ask a model to inspect the measured errors and produce a proposed prompt/research change with supporting run IDs. Store it for review; do not let it alter the live prompt or question selection.

Suggested append-only tables for the later implementation:

```sql
-- Conceptual schema; not a migration included in the current fix.
forecaster_versions(id, model, prompt_text, prompt_hash, calibration_json, created_at)
forecast_runs(id, round_date, version_id, role, started_at, committed_at,
              question_snapshot, evidence_json, status)
forecast_values(run_id, question_id, p_raw, p_scored)
forecast_evaluations(id, live_version, candidate_version, outcome_cutoff,
                     sample_size, coverage_json, metrics_json, created_at)
```

`role` distinguishes live from shadow. Candidate runs never populate competitive `questions.oracle_p_yes`. Require the same question identities, evidence cutoff and pre-opening deadline for both. Failed or late runs remain visible in coverage statistics; do not report accuracy only on the candidate's successful/easy subset.

Use a per-run content hash or explicit question revision in addition to IDs if questions may change before commitment. Keep evaluation snapshots: a corrected or voided outcome can change metrics, but should not erase the record of what justified a prior promotion.

## Start with calibration, then research changes

A simple candidate can reuse a live raw probability with a calibration transform. This requires no additional web research call:

```ts
function shrinkConfidence(p: number, alpha: number): number {
  if (!Number.isFinite(p) || !Number.isFinite(alpha) || p < 0 || p > 1 || alpha < 0 || alpha > 1) {
    throw new Error("invalid probability or shrinkage");
  }
  return 0.5 + alpha * (p - 0.5);
}

function brierScore(p: number, outcome: "yes" | "no"): number {
  return (p - (outcome === "yes" ? 1 : 0)) ** 2;
}
```

Alpha=1 is unchanged; alpha=0.8 moves 80% to 74%. The example is not a recommended fitted value. Fit candidate parameters on an older chronological training block, freeze the candidate, then assess on subsequent outcomes. Do not tune and evaluate on the same questions, use random train/test splits that leak future knowledge, or apply the game's 20-call display threshold as proof of an improvement.

A different prompt or research procedure requires its own forecasts produced before the outcomes. Asking today's model to replay old questions with unrestricted web access is not a clean historical test: it may already know what happened. Test those changes prospectively in shadow mode.

## Workflow and promotion

```text
Before opening:
  load finalized question snapshot
  run live forecaster and optional shadow candidate with a bounded budget
  validate outputs
  commit each eligible run before the common cutoff
  project only the live commitment into competitive probabilities

After resolution:
  join predictions to current yes/no outcomes
  exclude void/pending from scored rows; report their counts separately
  compute paired score differences and coverage
  persist the evaluation
  optionally generate an evidence-linked review proposal
```

Use durable Workflow steps for network calls, scoring, and report persistence. Choose a run key from round, version and role; database unique constraints make retries idempotent. Keep live-versus-shadow budgets separate so experiments cannot starve the daily Oracle or question production.

Promotion is initially a reviewed configuration change to the active version ID. Evaluate mean Brier loss, paired differences, coverage and uncertainty; account for correlated questions by grouping resampling at least by round. No fixed small sample size guarantees reliable improvement. Retain the live version unless evidence justifies a change. Preserve every historical forecast and version.

For tooling, the existing Vitest suite covers pure scoring and chronological split rules; PGlite tests schema/joins/idempotency; a local Postgres/Neon test database is needed for true multi-session concurrency tests. Existing operational logs can carry version IDs and coverage failures. Use the existing analytics provider for player engagement, not as the authoritative forecast ledger.

## Current fix rollout

Apply `apps/api/drizzle/0009_mighty_big_bertha.sql` before deploying code that reads the new round columns. Forecast attempts occur at 09:00, 10:00 and 11:00 ET under the existing minute<10 throttle. A finalized draft arriving after that preparation window, or a noon bank fallback, opens without a new Oracle duel. No post-opening catch-up is allowed. Once committed, content/source/criteria edits and rerolls are rejected; operational resolution and early-outcome void protection remain available.

Migration leaves historical forecasts unchanged and does not certify their commitment time. Learning evaluations should start with timestamped commitments, or explicitly separate legacy data of unknown cutoff provenance.

## References

- Cloudflare Workflows: https://developers.cloudflare.com/workflows/
- PostgreSQL function snapshot semantics: https://www.postgresql.org/docs/current/xfunc-volatility.html
- Existing implementation: `apps/api/src/pipeline/forecast.ts`, `workflows.ts`, `claude.ts`, and `packages/core/src/scoring.ts`.
