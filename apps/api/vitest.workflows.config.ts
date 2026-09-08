// A SECOND vitest project, deliberately separate (design 2026-09-08 §7.2).
//
// The PGlite suite (vitest.config.ts) must never be dragged into workerd: it
// uses node:fs to read drizzle migrations, and it is the regression net for
// everything else. This project tests ONLY step semantics — the things a
// stubbed "cloudflare:workers" (test/stubs/cloudflare-workers.ts) structurally
// cannot show, because it has no step engine at all.
//
// Package: @cloudflare/vitest-plugin@1.1.6 — NOT @cloudflare/vitest-pool-workers.
// Both names are live on npm and both ship an identical `introspectWorkflow` /
// `introspectWorkflowInstance` surface under "cloudflare:test" (verified by
// diffing their published tarballs on 2026-09-08); vitest-plugin is the name
// Cloudflare's current docs (developers.cloudflare.com/workers/testing/
// vitest-integration/get-started/write-your-first-test/) install, and it is a
// plugin-based config (`cloudflareTest()` inside `plugins: []`), not the
// `defineWorkersConfig` factory older docs and this task's brief describe —
// that factory does not exist in either package's current `exports`.
//
// Tests live in workflows-test/, NOT test/workflows/ as sketched in the task
// brief: vitest.config.ts (the PGlite project, not to be touched by this
// task) globs `test/**/*.test.ts`, which is recursive and would have picked
// up a test/workflows/*.test.ts file too — `pnpm test` would then fail to
// even collect it ("Cannot find package 'cloudflare:test'"), breaking the
// regression floor this task must leave untouched. test/tsconfig.json globs
// `test/**/*` the same way and would hit the same wall under `pnpm
// typecheck`. Living outside test/ entirely sidesteps both without editing
// either file.
//
// PIPELINE_ENABLED and DATABASE_URL are overridden here because
// AuthoringWorkflow/ResolutionWorkflow/ProbeWorkflow all early-return via
// buildPipelineDeps() when PIPELINE_ENABLED !== "true" (src/worker.ts), which
// would make every step in this file's tests unreachable. DATABASE_URL is a
// syntactically valid Postgres URL that is NEVER actually connected to: every
// step touching it is mocked via the introspector, and the one exception
// (resolveOne's error path) is deliberately swallowed internally rather than
// thrown (see test/workflows/steps.test.ts for why that matters).
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
	test: {
		include: ["workflows-test/**/*.test.ts"],
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				bindings: {
					PIPELINE_ENABLED: "true",
					DATABASE_URL: "postgres://test:test@127.0.0.1:5432/test",
				},
			},
		}),
	],
});
