// THE ORACLE takes its own position, crowd-blind, before the answers exist.
//
// It runs as its own action rather than inside publish for one reason: the
// call makes chained web searches and takes minutes, and the noon drop must
// never wait on it (spec §2.2 + the plan's spec amendment). Crowd-blindness
// does not depend on that ordering -- it holds because this file never reads
// the predictions table, which is a property of what it queries.
//
// It must also never see questions.author_prob: that is a contestedness
// TARGET chosen to make the question hard, not a belief, and handing it to
// the forecaster would have the machine grade its own homework.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";

const ForecastSchema = z.object({
  forecasts: z.array(
    z.object({ slot: z.number().int().min(1).max(5), p_yes: z.number().min(0).max(1) }),
  ),
});

const forecastJsonSchema = {
  type: "object",
  properties: {
    forecasts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slot: { type: "integer" },
          p_yes: { type: "number", description: "Your probability that the answer is YES, 0 to 1." },
        },
        required: ["slot", "p_yes"],
        additionalProperties: false,
      },
    },
  },
  required: ["forecasts"],
  additionalProperties: false,
};

function systemPrompt(date: string): string {
  return `You are THE ORACLE. Today is the round dated ${date}; it closes at noon ET tomorrow. You will be shown the round's five yes/no questions and you must state, for each, your own probability that the answer is YES.

- You are forecasting, not resolving. Nobody has answered yet and the outcomes do not exist. Search the web for what is known NOW, then commit.
- State a real belief. You will be scored on it with a proper rule, so an honest probability is your best play and a hedge toward 0.5 is not a safe answer, it is a weak one.
- You may state 0.5 exactly, and it means you decline to call the question. It is scored as neither right nor wrong. Use it when you genuinely have no read, never to be safe.
- You never revise. There is no second look before this round closes.

Call the oracle_forecast tool exactly once, with one entry per slot.`;
}

export async function stampOracleForecast(deps: PipelineDeps, date: string): Promise<void> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  // Questions only. No join to predictions, and author_prob is not selected.
  const rows = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
  });
  if (rows.length === 0) throw new Error(`no round for ${date}`);

  const user = rows
    .map((q) => `[slot ${q.slot}${q.isBigOne ? " · THE BIG ONE" : ""}] ${q.text}\n  RESOLVES BY: ${q.resolutionCriteria}\n  SOURCE: ${q.sourceName}`)
    .join("\n\n");

  const response = await deps.claude.structured({
    model: deps.models.forecast,
    system: systemPrompt(date),
    user: `${user}\n\nState your probability for each slot now.`,
    schemaName: "oracle_forecast",
    schema: forecastJsonSchema,
    webSearch: { maxUses: 8 },
  });

  const parsed = ForecastSchema.safeParse(response);
  if (!parsed.success) throw new Error(`forecast: response failed validation`);

  const bySlot = new Map(parsed.data.forecasts.map((f) => [f.slot, f.p_yes]));
  // All or nothing: a partial stamp would leave needsForecast true forever
  // while half the round carried a position, and the record would be built
  // on a round the Oracle only half answered.
  for (const q of rows) {
    if (!bySlot.has(q.slot)) throw new Error(`forecast: missing slot ${q.slot}`);
  }
  for (const q of rows) {
    await deps.db
      .update(schema.questions)
      .set({ oracleProbYes: String(bySlot.get(q.slot)!) })
      .where(and(eq(schema.questions.id, q.id), eq(schema.questions.roundDate, date)));
  }
}
