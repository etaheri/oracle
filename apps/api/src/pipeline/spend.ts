// The pipeline's daily model-call ceiling (design 2026-09-04 §9.1).
//
// A fully unattended loop with hourly retries has no upper bound on model
// calls. A pathological night — authoring failing validation, probes retrying —
// spends until the window closes. This caps it.
//
// THE CEILING IS APPLIED BY WRAPPING deps.claude, and that is the whole
// argument for its correctness: every model call the UNATTENDED loop makes
// goes through that one object, and no deterministic action (lock, publish,
// void, settle) touches it at all. The game therefore keeps turning after the
// budget is gone; only the machine's opinions stop.
//
// One path is NOT wrapped, and pre-dates this ceiling: an operator's Telegram
// /reroll (routes/telegram.ts) calls rerollSlot (pipeline/author.ts) with
// deps.pipeline, which is built UNMETERED, so that call reaches Anthropic
// without passing through this object. It is human-triggered and low-volume,
// but it means "every model call" above is a claim about the unattended
// pipeline, not a literal one about the process.
//
// The budget is an ops threshold, not a game rule, so it lives here beside
// BANK_LOW_WATER rather than in @oracle/core, whose header says "Scoring/game
// tunables".
import { sql } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import type { ClaudeClient, StructuredCall } from "./claude";

// Roughly three times a nominal night (authoring 1, critic 1, pre-flight ~12,
// taste 1, forecast 1, resolution 5x2, probes ~25 = ~52): high enough that a
// normal night never approaches it, low enough that a retry storm is capped
// within hours rather than days.
export const PIPELINE_DAILY_CALL_BUDGET = 150;

export class BudgetExhausted extends Error {
  /** True only on the call that crossed the line — the one tick that alerts. */
  readonly first: boolean;
  constructor(date: string, calls: number, first: boolean) {
    super(`pipeline: daily call budget exhausted for ${date} (${calls} of ${PIPELINE_DAILY_CALL_BUDGET})`);
    this.name = "BudgetExhausted";
    this.first = first;
  }
}

// One atomic statement, because neon-http has no transactions and two ticks
// can overlap: a read-then-write would lose counts under exactly the retry
// storm this exists to bound.
export async function chargeCall(db: Db, date: string): Promise<number> {
  const [row] = await db
    .insert(schema.pipelineSpend)
    .values({ date, calls: 1 })
    .onConflictDoUpdate({
      target: schema.pipelineSpend.date,
      set: { calls: sql`${schema.pipelineSpend.calls} + 1` },
    })
    .returning({ calls: schema.pipelineSpend.calls });
  return row!.calls;
}

export function meterClaude(db: Db, claude: ClaudeClient, date: string): ClaudeClient {
  return {
    async structured(call: StructuredCall): Promise<unknown> {
      // Charged BEFORE the call, never after: a call that throws still cost
      // tokens, and a meter that only counts successes is not a ceiling.
      const calls = await chargeCall(db, date);
      if (calls > PIPELINE_DAILY_CALL_BUDGET) {
        throw new BudgetExhausted(date, calls, calls === PIPELINE_DAILY_CALL_BUDGET + 1);
      }
      return claude.structured(call);
    },
  };
}

// The budget's one critical line, raised from whichever side crosses the
// ceiling. runTick catches it for the actions it still awaits inline; the
// Workflow entrypoints catch it for the fan-outs, which run on the far side of
// create() where the tick's own catch can never see them.
//
// Returns whether the error WAS a budget exhaustion, so a caller can skip its
// generic failure narration — an exhausted budget is a stated, expected end to
// the day's model calls, not an action that failed.
export async function reportBudgetExhaustion(
  telegram: { send(text: string): Promise<void> },
  err: unknown,
): Promise<boolean> {
  if (!(err instanceof BudgetExhausted)) return false;
  // Only the call that crossed the line narrates. Every later one this day
  // carries first === false and stays silent, including a Workflow step's
  // retries, which charge again and therefore can never look like the first.
  if (err.first) {
    await telegram.send(
      `‼️ the daily model-call budget of ${PIPELINE_DAILY_CALL_BUDGET} is spent — no further model calls today; the bank covers noon`,
    );
  }
  return true;
}
