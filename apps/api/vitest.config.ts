import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		pool: "forks",
		maxWorkers: 1,
	},
	resolve: {
		alias: {
			// worker.ts re-exports the Workflow entrypoints (Cloudflare requires
			// them on the main module), and those import "cloudflare:workers" and
			// "cloudflare:workflows" (NonRetryableError lives on the latter, per
			// @cloudflare/workers-types), neither of which resolve outside workerd.
			// Point both at the same stub so the api suite can keep importing
			// ../src/worker.
			"cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
			"cloudflare:workflows": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
		},
	},
});
