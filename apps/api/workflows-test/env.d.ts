// Ambient binding types for the workerd introspector suite (design
// 2026-09-08 §7.2), needed so `npx tsc -p workflows-test/tsconfig.json` can
// typecheck it (that coverage is FIX 7 of the 2026-09-08 final review).
//
// wrangler.jsonc declares AUTHORING_WORKFLOW / RESOLUTION_WORKFLOW /
// PROBE_WORKFLOW, but this project has no `wrangler types` step — no
// worker-configuration.d.ts is generated — so `Cloudflare.Env`, the type
// `introspectWorkflowInstance`'s `env` parameter (from "cloudflare:test")
// carries, stays the empty interface @cloudflare/workers-types declares.
// This augments just the three bindings workflows-test/*.test.ts actually
// reads, rather than inventing a full generated env file this task doesn't
// need.
declare namespace Cloudflare {
  interface Env {
    AUTHORING_WORKFLOW: Workflow;
    RESOLUTION_WORKFLOW: Workflow;
    PROBE_WORKFLOW: Workflow;
  }
}
