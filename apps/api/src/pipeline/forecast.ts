// The Oracle researches a finalized scheduled round. Only the database can
// commit it: one transaction, before opening, with the exact input snapshot.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";

export const FORECAST_PROMPT_VERSION = "forecast-v2";
const ForecastSchema = z.object({
  forecasts: z.array(z.object({
    slot: z.number().int().min(1).max(5), p_yes: z.number().min(0).max(1),
  })).length(5).refine(rows => new Set(rows.map(r => r.slot)).size === 5, "slots must be exactly 1..5"),
});
const forecastJsonSchema = {
  type: "object", properties: {
    forecasts: { type: "array", minItems: 5, maxItems: 5, items: {
      type: "object", properties: {
        slot: { type: "integer", minimum: 1, maximum: 5 },
        p_yes: { type: "number", minimum: 0, maximum: 1, description: "Your probability that the answer is YES, 0 to 1." },
      }, required: ["slot", "p_yes"], additionalProperties: false,
    } },
  }, required: ["forecasts"], additionalProperties: false,
};

function systemPrompt(date: string): string {
  return `You are THE ORACLE. You are preparing the round dated ${date}, before it opens. It closes at noon ET the following day. State your own probability of YES for each question.

- Research only evidence available now. You are forecasting, not resolving.
- Report your best-supported probability. Do not exaggerate confidence or hedge for appearances. A proper scoring rule rewards an accurate expression of your uncertainty.
- Exactly 0.5 is a valid probability when the evidence supports equal chances. It earns zero base points and has no directional correct-answer count.
- These forecasts will be sealed before players can answer. No revision is allowed after commitment.

Call the oracle_forecast tool exactly once with exactly one entry for each slot 1 through 5.`;
}

export async function stampOracleForecast(deps: PipelineDeps, date: string): Promise<void> {
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round) throw new Error("forecast: round missing");
  // Idempotent retries do not spend tokens, even when the model is unavailable.
  if (round.oracleCommittedAt !== null) return;
  if (round.status !== "scheduled") throw new Error("forecast: round already opened");
  if (!deps.claude) throw new Error("pipeline: no claude client");

  // Author probabilities and player/crowd data are deliberately not selected.
  const rows = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, isBigOne: true, text: true, category: true,
      resolutionCriteria: true, sourceName: true, sourceUrl: true, context: true,
      opensAt: true, locksAt: true, status: true, outcome: true, oracleProbYes: true },
  });
  if (rows.length !== 5 || rows.some((q, i) => q.slot !== i + 1)) throw new Error("forecast: five unique slots required");
  const opening = Math.min(...rows.map(q => q.opensAt.getTime()));
  if (deps.now().getTime() >= opening) throw new Error("forecast: opening deadline passed");
  if (rows.some(q => q.status !== "scheduled" || q.outcome !== null || q.oracleProbYes !== null)) {
    throw new Error("forecast: questions not eligible for a new commitment");
  }

  const user = rows.map(q => `[slot ${q.slot}${q.isBigOne ? " · THE BIG ONE" : ""}] ${q.text}\nRESOLVES BY: ${q.resolutionCriteria}\nSOURCE: ${q.sourceName}${q.sourceUrl ? ` · ${q.sourceUrl}` : ""}\nOPENS: ${q.opensAt.toISOString()}\nLOCKS: ${q.locksAt.toISOString()}${q.context ? `\nCONTEXT: ${JSON.stringify(q.context)}` : ""}`).join("\n\n");
  const response = await deps.claude.structured({
    model: deps.models.forecast, system: systemPrompt(date), user,
    schemaName: "oracle_forecast", schema: forecastJsonSchema, webSearch: { maxUses: 8 },
  });
  const parsed = ForecastSchema.safeParse(response);
  if (!parsed.success) throw new Error("forecast: response failed validation (exact slots required)");
  const completedAt = deps.now();
  if (completedAt.getTime() >= opening) throw new Error("forecast: opening deadline passed");
  const bySlot = new Map(parsed.data.forecasts.map(f => [f.slot, f.p_yes]));
  const snapshot = rows.map(({ status: _status, outcome: _outcome, oracleProbYes: _old, ...q }) => ({ ...q, pYes: bySlot.get(q.slot)! }));
  // The function locks/rechecks live rows, compares the entire snapshot, and
  // uses the DB clock after lock waits. Any failure rolls back all five writes.
  await deps.db.execute(sql`select commit_oracle_forecast(
    ${date}::date, ${JSON.stringify(snapshot)}::jsonb, ${deps.models.forecast},
    ${FORECAST_PROMPT_VERSION}, ${completedAt.toISOString()}::timestamptz
  )`);
}
