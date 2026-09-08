// The execution substrate (design 2026-09-04 §2): cron DECIDES, a Workflow
// EXECUTES.
//
// THE LIMIT, MEASURED. Cloudflare Cron Triggers on a sub-hour schedule get 30
// seconds of CPU and a HARD 15-MINUTE WALL-CLOCK CAP. CPU is not the
// constraint here — waiting on fetch is I/O. The 15 minutes is, and runTick's
// resolve case USED TO sit on it: five sequential resolves, each of which
// "can take minutes across chained web searches" by resolve.ts's own
// admission, once ran inline as a single unbroken call with no checkpoint
// between them. It never bit only because the pipeline had never run an
// unattended day. The gauntlet adds roughly eight more long calls to the
// authoring tick.
//
// A Workflow INSTANCE has no wall-clock limit — that is what makes this
// substrate the fix for the cap above. A STEP does: Cloudflare's default step
// config carries a 10-MINUTE TIMEOUT, and THAT DEFAULT IS NEVER INHERITED
// here. Every step this pipeline runs carries its own explicit timeout and
// retry policy, chosen from the POLICY table in steps.ts by kind of work (see
// that file's header for why the inherited default was the defect in the
// first place). Granularity — many short, independently-checkpointed steps —
// is what makes fan-out of long external calls safe, not an unbounded
// per-step clock.
//
// decideActions DOES NOT CHANGE ITS NATURE. It stays pure over
// (ETNow, PipelineState) — that purity is what makes every action idempotent,
// replayable and testable, and it is a better property for DECIDING than
// durable execution is. What changes is only that runTick starts long work
// rather than awaiting it.
import type { ETNow } from "./clock";
import type { PipelineDeps } from "./index";

export type WorkflowKind = "author" | "resolve" | "probe";

export interface WorkflowStarter {
  // deps is passed AT START TIME rather than captured at construction, so
  // runTick can hand the inline path its METERED Claude client — inline
  // execution is then charged against the spend ceiling exactly as dispatched
  // execution is. bindingStarter ignores it.
  start(
    deps: PipelineDeps,
    kind: WorkflowKind,
    id: string,
    params: { date: string; questionIds?: string[] },
  ): Promise<void>;
}

// The hour bucket is what makes idempotency FALL OUT of throttles that already
// exist: decideActions fires author and resolve at most once an hour, so a
// duplicate create inside the same hour collides on this id and is skipped,
// while a new hour gets a fresh instance — which is exactly the hourly-retry
// semantics the state machine already specifies.
export function hourBucket(now: ETNow): string {
  return `${now.date.replace(/-/g, "")}${String(now.hour).padStart(2, "0")}`;
}

// The subset of Cloudflare's Workflow binding this file uses. Declared
// structurally so the tests can pass a plain object and the Worker types stay
// out of the test tsconfig.
//
// What the STARTER needs: dispatch, nothing else. bindingStarter never reads
// an instance back, which is why its tests can pass a one-method fake.
export interface WorkflowBinding {
  create(options: { id: string; params: { date: string; questionIds?: string[] } }): Promise<unknown>;
}
export interface WorkflowBindings {
  AUTHORING_WORKFLOW: WorkflowBinding;
  RESOLUTION_WORKFLOW: WorkflowBinding;
  PROBE_WORKFLOW: WorkflowBinding;
}

export interface WorkflowInstanceHandle {
  status(): Promise<unknown>;
  restart(options?: { from?: { name: string; count?: number; type?: "do" | "sleep" | "waitForEvent" } }): Promise<void>;
}
// What the ADMIN SURFACE needs: dispatch plus instance lookup. Cloudflare's
// real binding satisfies both; splitting them keeps each consumer's
// requirement visible in its own type rather than in a comment.
export interface WorkflowInstanceBinding extends WorkflowBinding {
  get(id: string): Promise<WorkflowInstanceHandle>;
}
export interface WorkflowInstanceBindings {
  AUTHORING_WORKFLOW: WorkflowInstanceBinding;
  RESOLUTION_WORKFLOW: WorkflowInstanceBinding;
  PROBE_WORKFLOW: WorkflowInstanceBinding;
}

const DUPLICATE = /already exists|instance\.already_exists|duplicate/i;

export function bindingStarter(bindings: WorkflowBindings): WorkflowStarter {
  const of: Record<WorkflowKind, WorkflowBinding> = {
    author: bindings.AUTHORING_WORKFLOW,
    resolve: bindings.RESOLUTION_WORKFLOW,
    probe: bindings.PROBE_WORKFLOW,
  };
  return {
    // The deps argument is ignored here on purpose: the Workflow builds its own
    // PipelineDeps from env on the other side of the dispatch. It exists so
    // inlineStarter can receive runTick's metered client.
    async start(_deps, kind, id, params) {
      try {
        await of[kind].create({ id, params });
      } catch (err) {
        // A COLLISION IS THE IDEMPOTENCY, not a failure: this hour's instance
        // already exists and is already doing the work.
        if (err instanceof Error && DUPLICATE.test(err.message)) return;
        throw err;
      }
    },
  };
}

// Runs the workflow's body in-process instead of dispatching it. This is a real
// fallback, not a stub: everything the Workflow would do happens, just inside
// the tick's own 15 minutes. Tests and `wrangler dev` take this path, which is
// why every existing tick test keeps asserting the same outcomes.
//
// The runners are imported lazily to keep this module free of an import cycle
// (index.ts -> workflows.ts -> gauntlet -> index.ts).
export function inlineStarter(): WorkflowStarter {
  return {
    async start(deps, kind, _id, params) {
      if (kind === "author") {
        const { runAuthoringGauntlet } = await import("./gauntlet");
        await runAuthoringGauntlet(deps, params.date);
      } else if (kind === "resolve") {
        const { runResolution } = await import("./resolve");
        await runResolution(deps, params.date, params.questionIds ?? []);
      } else {
        const { runProbe } = await import("./probe");
        await runProbe(deps, params.date, params.questionIds ?? []);
      }
    },
  };
}
