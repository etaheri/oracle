// Pins the checkpointing refactor in src/pipeline/workflow-entrypoints.ts
// (design 2026-09-08 §3-5) against the real Workflows step engine — the one
// thing the stubbed "cloudflare:workers" in the PGlite suite structurally
// cannot exercise, because that stub has no step engine at all.
//
// A load-bearing fact about this introspector, discovered empirically while
// writing these tests (mockStepError/mockStepResult replace a step's REAL
// callback outright — confirmed by watching an unmocked "context" step throw
// real DB-query errors from src/pipeline/gauntlet/generate.ts, while a mocked
// step never touches its real implementation at all): a mocked failure can
// only ever exercise the ENGINE's own retry accounting for the policy passed
// to `step.do()`. It can never reach the `catch` inside `durableStep`
// (workflow-entrypoints.ts) that converts a THROWN `BudgetExhausted` into a
// `NonRetryableError`, because that catch lives inside the very callback the
// mock replaces. See the last test below for what that means for defect
// §1.3's coverage here.
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("resolution workflow step semantics", () => {
	it("gives each question its own step, so no single step spans multiple resolves (defect §1.1)", async () => {
		// If a future edit re-collapsed this back into one step wrapping a loop,
		// these two step names would stop existing and the mocks below would
		// silently miss — the real (unmocked) steps would then run for real
		// against an unreachable DATABASE_URL. That instance would go
		// `errored`, not `complete`, so waitForStatus("complete") would hang to
		// the test timeout rather than reject — still failing this test.
		await using instance = await introspectWorkflowInstance(env.RESOLUTION_WORKFLOW, "t-1");
		await instance.modify(async (m) => {
			await m.disableRetryDelays();
			await m.mockStepResult({ name: "resolve-q1" }, { questionId: "q1", resolved: true });
			await m.mockStepResult({ name: "resolve-q2" }, { questionId: "q2", resolved: true });
		});
		await env.RESOLUTION_WORKFLOW.create({ id: "t-1", params: { date: "2026-09-08", questionIds: ["q1", "q2"] } });
		await instance.waitForStatus("complete");
		const output = await instance.getOutput();
		expect(output).toEqual({ resolved: 2, total: 2 });
	});

	it("does NOT retry a resolve step — the hourly cron re-dispatch is that retry layer (spec §4.1)", async () => {
		// The introspector exposes no attempt-count API (checked against
		// developers.cloudflare.com/workers/testing/vitest-integration/test-apis/
		// on 2026-09-08 — WorkflowInstanceIntrospector has waitForStepResult,
		// waitForStatus, getOutput, getError and dispose; nothing else), so an
		// attempts-counter assertion is not available and is not attempted here.
		//
		// Instead this exploits resolveOne's own defensiveness (resolve.ts):
		// it catches every non-BudgetExhausted error and returns a normal
		// {resolved: false, error} result rather than throwing. mockStepError's
		// `times: 1` argument makes the mock fire on attempt 1 only — a SECOND
		// attempt, if the engine ever made one, would run resolveOne for real
		// and it would swallow the error and SUCCEED, taking the instance to
		// "complete" instead of "errored". So an "errored" instance whose
		// getError().message is exactly the mocked message is proof no second
		// attempt happened — i.e. POLICY.noRetry's retries.limit: 0 held.
		// (Verified the other direction too: mocking the same way against a
		// step with retries configured — POLICY.model's limit: 2, on
		// AuthoringWorkflow's "generate" step — does surface a real second
		// attempt's error instead of the mock's, confirming this technique
		// actually distinguishes retried from not-retried rather than always
		// reading one way.)
		await using instance = await introspectWorkflowInstance(env.RESOLUTION_WORKFLOW, "t-2");
		await instance.modify(async (m) => {
			await m.disableRetryDelays();
			await m.mockStepError({ name: "resolve-q1" }, new Error("boom"), 1);
		});
		await env.RESOLUTION_WORKFLOW.create({ id: "t-2", params: { date: "2026-09-08", questionIds: ["q1"] } });
		await instance.waitForStatus("errored");
		const err = await instance.getError();
		expect(err.message).toBe("boom");
	});

	it("stops the AuthoringWorkflow instance on a step failure instead of continuing past it (defect §1.3, partial)", async () => {
		// What this DOES pin: a step failure halts run() — the instance reaches
		// "errored" carrying exactly the failing step's message, rather than
		// silently continuing to "screen"/"critic"/"commit"/"narrate" with
		// partial state, or hanging.
		//
		// What this CANNOT pin, per this file's header comment: that a REAL
		// BudgetExhausted specifically (as opposed to any other error) skips
		// POLICY.model's configured retries via durableStep's NonRetryableError
		// mapping. Exercising that mapping for real requires the "generate"
		// step's actual callback to throw a genuine BudgetExhausted, which
		// means a live database whose pipeline_spend row is already past
		// PIPELINE_DAILY_CALL_BUDGET — out of reach for an introspector whose
		// whole point is to mock steps without one. That mapping is presently
		// unverified by any automated test; this suite narrows but does not
		// close that gap.
		await using instance = await introspectWorkflowInstance(env.AUTHORING_WORKFLOW, "t-3");
		await instance.modify(async (m) => {
			await m.disableRetryDelays();
			await m.mockStepResult({ name: "context" }, { recentTopicKeys: [] });
			await m.mockStepError({ name: "generate" }, new Error("pipeline: daily call budget exhausted"));
		});
		await env.AUTHORING_WORKFLOW.create({ id: "t-3", params: { date: "2026-09-08" } });
		await instance.waitForStatus("errored");
		const err = await instance.getError();
		expect(err.message).toBe("pipeline: daily call budget exhausted");
	});
});
