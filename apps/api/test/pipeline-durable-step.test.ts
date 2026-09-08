// durableStep (workflow-entrypoints.ts) is the ONE place BudgetExhausted gets
// mapped into a NonRetryableError (defect §1.3, design 2026-09-08). The
// workerd suite (apps/api/workflows-test/) cannot reach this code at all: its
// introspector's mockStepError/mockStepResult replace a step's real callback
// outright, and this mapping's `catch` lives INSIDE that callback — see that
// suite's header comment for how that was confirmed. `step` being an ordinary
// parameter of durableStep is what makes the mapping itself testable here,
// with no engine and no database: a fake `step.do` that just calls back into
// its own callback reaches the exact same catch a real Workflow step would.
import { describe, expect, it } from "vitest";
import { durableStep } from "../src/pipeline/workflow-entrypoints";
import { BudgetExhausted } from "../src/pipeline/spend";
import { NonRetryableError } from "cloudflare:workflows";
import { POLICY } from "../src/pipeline/steps";
import type { PipelineDeps } from "../src/pipeline";
import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";

// Records what durableStep hands to `step.do`, then just invokes the
// callback — the same shape a real WorkflowStep.do ultimately reduces to,
// minus everything about checkpointing/retries/timeouts that only the real
// engine (exercised in apps/api/workflows-test/) can enforce.
function fakeStep() {
  const calls: { name: string; config: WorkflowStepConfig }[] = [];
  const step = {
    async do(name: string, config: WorkflowStepConfig, callback: () => Promise<unknown>) {
      calls.push({ name, config });
      return callback();
    },
  };
  return { step: step as unknown as WorkflowStep, calls };
}

function fakeDeps(): { deps: PipelineDeps; sent: string[] } {
  const sent: string[] = [];
  const deps: PipelineDeps = {
    db: {} as unknown as PipelineDeps["db"], // never touched by durableStep or reportBudgetExhaustion
    claude: null,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    telegram: { send: async (t) => void sent.push(t) },
    now: () => new Date("2026-09-08T12:00:00Z"),
    workflows: { start: async () => {} },
  };
  return { deps, sent };
}

describe("durableStep — the BudgetExhausted -> NonRetryableError mapping (defect §1.3)", () => {
  it("maps a thrown BudgetExhausted into a NonRetryableError named BudgetExhausted, and narrates it once", async () => {
    const { step } = fakeStep();
    const { deps, sent } = fakeDeps();
    const budgetErr = new BudgetExhausted("2026-09-08", 151, /* first */ true);

    const rejection = durableStep(step, "generate", POLICY.model, deps, async () => {
      throw budgetErr;
    });

    await expect(rejection).rejects.toThrow(NonRetryableError);
    await rejection.catch((err: unknown) => {
      expect(err).toBeInstanceOf(NonRetryableError);
      expect((err as Error).name).toBe("BudgetExhausted");
      expect((err as Error).message).toBe(budgetErr.message);
    });
    // reportBudgetExhaustion(deps.telegram, err) is the only thing in
    // durableStep's catch that touches telegram, and it sends exactly once
    // per crossing (err.first === true here) — this is that send firing.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("budget");
  });

  it("leaves an ordinary error untouched — no wrapping, so it stays retryable", async () => {
    // The opposite direction matters just as much: if durableStep wrapped
    // EVERY thrown error in NonRetryableError, every transient failure would
    // stop retrying, which is a regression in the other direction from §1.3.
    const { step } = fakeStep();
    const { deps, sent } = fakeDeps();
    const boom = new Error("transient: fetch failed");

    const rejection = durableStep(step, "sources", POLICY.sourceFetch, deps, async () => {
      throw boom;
    });

    await expect(rejection).rejects.toBe(boom);
    await rejection.catch((err: unknown) => {
      expect(err).not.toBeInstanceOf(NonRetryableError);
    });
    expect(sent).toHaveLength(0);
  });

  it("forwards the policy's timeout and retries to step.do unaltered", async () => {
    const { step, calls } = fakeStep();
    const { deps } = fakeDeps();

    const result = await durableStep(step, "resolve-q1", POLICY.noRetry, deps, async () => "ok");

    expect(result).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("resolve-q1");
    expect(calls[0]?.config).toEqual({ timeout: POLICY.noRetry.timeout, retries: POLICY.noRetry.retries });
  });
});
