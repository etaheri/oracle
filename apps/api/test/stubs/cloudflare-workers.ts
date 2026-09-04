// A runtime stand-in for Cloudflare's `cloudflare:workers` module, aliased in
// vitest.config.ts.
//
// WHY THIS EXISTS. Cloudflare requires Workflow classes to be exported from
// the Worker's main module, so worker.ts re-exports workflow-entrypoints.ts,
// which imports `cloudflare:workers`. That specifier only resolves inside
// workerd. Several tests import buildPipelineDeps from ../src/worker, so
// without this alias vitest would follow the re-export, fail to resolve the
// module, and take the entire api suite down.
//
// It needs no behaviour: the entrypoint classes are thin shells over ordinary
// functions (runAuthoringGauntlet, runResolution, runProbe) that are tested
// directly against PGlite. WorkflowEvent and WorkflowStep are types only and
// so need no runtime shape at all.
export class WorkflowEntrypoint<Env = unknown, _T = unknown> {
  constructor(
    public ctx: unknown,
    public env: Env,
  ) {}
}
