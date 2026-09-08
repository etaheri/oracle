// Usage telemetry (design 2026-09-08 §4.6). An INSTRUMENT.
//
// It answers one question — "is the call-count proxy drifting?" — and gates
// nothing. The ceiling stays a call count in spend.ts, deliberately: a price
// table inside a control path drifts silently whenever pricing changes and
// then fails either open (spending more than the operator believes) or closed
// (killing the drop for nothing).
import { sql } from "drizzle-orm";
import { schema, type Db } from "../db/client";

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}

/** One atomic upsert, for the same reason chargeCall is one: neon-http has no
 *  interactive transactions and two ticks can overlap. */
export async function recordUsage(db: Db, date: string, u: CallUsage): Promise<void> {
  await db
    .insert(schema.pipelineUsage)
    .values({
      date,
      model: u.model,
      calls: 1,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      webSearches: u.webSearches,
    })
    .onConflictDoUpdate({
      target: [schema.pipelineUsage.date, schema.pipelineUsage.model],
      set: {
        calls: sql`${schema.pipelineUsage.calls} + 1`,
        inputTokens: sql`${schema.pipelineUsage.inputTokens} + ${u.inputTokens}`,
        outputTokens: sql`${schema.pipelineUsage.outputTokens} + ${u.outputTokens}`,
        webSearches: sql`${schema.pipelineUsage.webSearches} + ${u.webSearches}`,
      },
    });
}
