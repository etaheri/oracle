// The three Workflow classes (design 2026-09-04 §2). Separate from
// workflows.ts on purpose: this is the only file in the pipeline that imports
// "cloudflare:workers", a specifier that resolves solely inside workerd, and
// only worker.ts imports it. workflows.ts keeps WorkflowStarter, hourBucket,
// bindingStarter and inlineStarter, all of which are plain TypeScript and
// testable without the runtime.
//
// Each class is a thin shell. All the work lives in ordinary async functions
// that take PipelineDeps, so every one of them is testable against PGlite with
// a fake Claude client — a Workflow class is not.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { buildPipelineDeps, type WorkerEnv } from "../worker";
import { meterClaude, reportBudgetExhaustion } from "./spend";
import { etNow } from "./clock";
import { runAuthoringGauntlet } from "./gauntlet";
import { runResolution } from "./resolve";
import { runProbe } from "./probe";
import type { PipelineDeps } from "./index";

interface Params { date: string; questionIds?: string[] }

// A Workflow instance builds its own deps from env — it is on the far side of
// the dispatch and shares nothing with the tick that started it. The spend
// ceiling therefore has to be applied here too, or every long call would escape
// the meter the moment the substrate started working.
function metered(env: WorkerEnv): PipelineDeps | null {
  const deps = buildPipelineDeps(env);
  if (!deps) return null;
  const et = etNow(new Date());
  return { ...deps, claude: deps.claude ? meterClaude(deps.db, deps.claude, et.date) : null };
}

// A Workflow body runs on the FAR SIDE of create(): bindingStarter.start
// resolves the moment the instance exists, so runTick's own catch can never see
// what happens in here. Without this wrapper a BudgetExhausted raised by the
// metered client above would only fail a step — retried, then dead — and the
// one critical the ceiling exists to send would never be sent.
//
// The error is rethrown, not handled: the step must still fail so the instance
// records it. This is narration, not recovery.
async function narrating(deps: PipelineDeps, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    await reportBudgetExhaustion(deps.telegram, err);
    throw err;
  }
}

export class AuthoringWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    await step.do("gauntlet", async () => {
      const deps = metered(this.env);
      if (!deps) return;
      await narrating(deps, () => runAuthoringGauntlet(deps, event.payload.date));
    });
  }
}

export class ResolutionWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    await step.do("resolve", async () => {
      const deps = metered(this.env);
      if (!deps) return;
      await narrating(deps, () => runResolution(deps, event.payload.date, event.payload.questionIds ?? []));
    });
  }
}

export class ProbeWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    await step.do("probe", async () => {
      const deps = metered(this.env);
      if (!deps) return;
      await narrating(deps, () => runProbe(deps, event.payload.date, event.payload.questionIds ?? []));
    });
  }
}
