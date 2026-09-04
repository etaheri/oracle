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
			// them on the main module), and those import "cloudflare:workers",
			// which only resolves inside workerd. Point it at a stub so the api
			// suite can keep importing ../src/worker.
			"cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
		},
	},
});
