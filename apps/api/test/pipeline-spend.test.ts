import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { chargeCall, meterClaude, reportBudgetExhaustion, BudgetExhausted, PIPELINE_DAILY_CALL_BUDGET } from "../src/pipeline/spend";
import type { ClaudeClient } from "../src/pipeline/claude";

const okClaude: ClaudeClient = { structured: async () => ({ ok: true }) };

describe("chargeCall", () => {
  it("creates the day's row on first call and increments after", async () => {
    const { db } = await makeTestDb();
    expect(await chargeCall(db, "2026-09-04")).toBe(1);
    expect(await chargeCall(db, "2026-09-04")).toBe(2);
    const row = await db.query.pipelineSpend.findFirst({ where: eq(schema.pipelineSpend.date, "2026-09-04") });
    expect(row!.calls).toBe(2);
  });

  it("counts each ET day separately", async () => {
    const { db } = await makeTestDb();
    await chargeCall(db, "2026-09-04");
    expect(await chargeCall(db, "2026-09-05")).toBe(1);
  });
});

describe("meterClaude", () => {
  it("charges before the call and passes the call through", async () => {
    const { db } = await makeTestDb();
    let seen = 0;
    const metered = meterClaude(db, { structured: async () => { seen++; return { ok: true }; } }, "2026-09-04");
    await metered.structured({ model: "m", system: "s", user: "u", schemaName: "n", schema: {} });
    expect(seen).toBe(1);
    const row = await db.query.pipelineSpend.findFirst({ where: eq(schema.pipelineSpend.date, "2026-09-04") });
    expect(row!.calls).toBe(1);
  });

  it("throws BudgetExhausted past the ceiling and never reaches the model", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: PIPELINE_DAILY_CALL_BUDGET });
    let reached = false;
    const metered = meterClaude(db, { structured: async () => { reached = true; return {}; } }, "2026-09-04");
    await expect(
      metered.structured({ model: "m", system: "s", user: "u", schemaName: "n", schema: {} }),
    ).rejects.toBeInstanceOf(BudgetExhausted);
    expect(reached).toBe(false);
  });

  it("marks only the crossing call as first, so the critical alert fires once", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: PIPELINE_DAILY_CALL_BUDGET });
    const metered = meterClaude(db, okClaude, "2026-09-04");
    const call = { model: "m", system: "s", user: "u", schemaName: "n", schema: {} };
    const first = await metered.structured(call).catch((e: unknown) => e as BudgetExhausted);
    const second = await metered.structured(call).catch((e: unknown) => e as BudgetExhausted);
    expect((first as BudgetExhausted).first).toBe(true);
    expect((second as BudgetExhausted).first).toBe(false);
  });
});

describe("reportBudgetExhaustion", () => {
  const fake = () => {
    const sent: string[] = [];
    return { sent, telegram: { send: async (t: string) => void sent.push(t) } };
  };

  it("narrates the one critical for the call that crossed the line, and says it handled it", async () => {
    const { sent, telegram } = fake();
    const handled = await reportBudgetExhaustion(telegram, new BudgetExhausted("2026-09-04", PIPELINE_DAILY_CALL_BUDGET + 1, true));
    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(
      `‼️ the daily model-call budget of ${PIPELINE_DAILY_CALL_BUDGET} is spent — no further model calls today; the bank covers noon`,
    );
  });

  it("stays silent for every later exhaustion that day, but still says it handled it", async () => {
    const { sent, telegram } = fake();
    const handled = await reportBudgetExhaustion(telegram, new BudgetExhausted("2026-09-04", PIPELINE_DAILY_CALL_BUDGET + 9, false));
    expect(handled).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("does not touch any other error — the caller keeps its own narration", async () => {
    const { sent, telegram } = fake();
    expect(await reportBudgetExhaustion(telegram, new Error("the source did not answer"))).toBe(false);
    expect(await reportBudgetExhaustion(telegram, "not even an error")).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
