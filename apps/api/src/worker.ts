import { createApp } from "./app";
import { makeDb } from "./db/client";
import { runTick, type PipelineDeps } from "./pipeline";
import { makeTelegramClient } from "./pipeline/telegram";
import { makeClaudeClient } from "./pipeline/claude";
import { recordUsage } from "./pipeline/usage";
import { etNow } from "./pipeline/clock";
import { bindingStarter, inlineStarter, type WorkflowBinding } from "./pipeline/workflows";

// Cloudflare requires Workflow classes to be exported from the Worker's main
// module, which is why this re-export lives here rather than the classes being
// referenced only by wrangler.jsonc.
export { AuthoringWorkflow, ResolutionWorkflow, ProbeWorkflow } from "./pipeline/workflow-entrypoints";

export interface WorkerEnv {
  DATABASE_URL: string;
  DEVICE_TOKEN_SECRET: string;
  ADMIN_SECRET: string;
  ANTHROPIC_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  PIPELINE_ENABLED?: string;
  PIPELINE_AUTHOR_MODEL?: string;
  PIPELINE_RESOLVE_MODEL?: string;
  PIPELINE_RESOLVE_MODEL_B?: string;
  PIPELINE_FORECAST_MODEL?: string;
  PIPELINE_CRITIC_MODEL?: string;
  PIPELINE_PREFLIGHT_MODEL?: string;
  PIPELINE_PROBE_MODEL?: string;
  PIPELINE_TASTE_MODEL?: string;
  REVENUECAT_WEBHOOK_SECRET?: string;
  APPLE_BUNDLE_ID?: string;
  ONESIGNAL_APP_ID?: string;
  ONESIGNAL_API_KEY?: string;
  AUTHORING_WORKFLOW?: WorkflowBinding;
  RESOLUTION_WORKFLOW?: WorkflowBinding;
  PROBE_WORKFLOW?: WorkflowBinding;
}

// Enablement gate (spec §11): the pipeline is fully wired but stays inert
// until PIPELINE_ENABLED="true" is set — everywhere else (fetch, scheduled)
// treats an undefined return as "pipeline off".
export function buildPipelineDeps(env: WorkerEnv): PipelineDeps | undefined {
  if (env.PIPELINE_ENABLED !== "true") return undefined;
  const bindings =
    env.AUTHORING_WORKFLOW && env.RESOLUTION_WORKFLOW && env.PROBE_WORKFLOW
      ? {
          AUTHORING_WORKFLOW: env.AUTHORING_WORKFLOW,
          RESOLUTION_WORKFLOW: env.RESOLUTION_WORKFLOW,
          PROBE_WORKFLOW: env.PROBE_WORKFLOW,
        }
      : null;
  if (!bindings) {
    // Not fatal, but it means authoring and resolution run inside the cron's
    // hard 15-minute cap — which is the exact bug the Workflow substrate
    // exists to fix (design 2026-09-04 §2.1).
    console.warn("pipeline: no Workflow bindings; long actions will run inline inside the cron's 15-minute cap");
  }
  const db = makeDb(env.DATABASE_URL);
  return {
    db,
    telegram: makeTelegramClient(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID),
    claude: env.ANTHROPIC_API_KEY
      ? makeClaudeClient(env.ANTHROPIC_API_KEY, fetch, (u) => recordUsage(db, etNow(new Date()).date, u))
      : null,
    models: {
      author: env.PIPELINE_AUTHOR_MODEL ?? "claude-opus-5",
      resolve: env.PIPELINE_RESOLVE_MODEL ?? "claude-sonnet-5",
      // A DIFFERENT model, not the same one twice: running one model twice
      // correlates its errors, so agreement would mean nothing. Independent
      // errors require independent models (design 2026-09-04 §6.2).
      resolveB: env.PIPELINE_RESOLVE_MODEL_B ?? "claude-opus-5",
      forecast: env.PIPELINE_FORECAST_MODEL ?? "claude-sonnet-5",
      critic: env.PIPELINE_CRITIC_MODEL ?? "claude-opus-5",
      preflight: env.PIPELINE_PREFLIGHT_MODEL ?? "claude-sonnet-5",
      probe: env.PIPELINE_PROBE_MODEL ?? "claude-sonnet-5",
      taste: env.PIPELINE_TASTE_MODEL ?? "claude-haiku-4-5-20251001",
    },
    now: () => new Date(),
    // inlineStarter() takes no arguments: runTick hands it the metered deps at
    // start time, which is the whole reason WorkflowStarter.start carries deps.
    workflows: bindings ? bindingStarter(bindings) : inlineStarter(),
    push: { ONESIGNAL_APP_ID: env.ONESIGNAL_APP_ID, ONESIGNAL_API_KEY: env.ONESIGNAL_API_KEY },
  };
}

export default {
  fetch(req: Request, env: WorkerEnv) {
    const app = createApp({
      db: makeDb(env.DATABASE_URL),
      env: {
        DEVICE_TOKEN_SECRET: env.DEVICE_TOKEN_SECRET,
        ADMIN_SECRET: env.ADMIN_SECRET,
        TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
        TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
        REVENUECAT_WEBHOOK_SECRET: env.REVENUECAT_WEBHOOK_SECRET,
        APPLE_BUNDLE_ID: env.APPLE_BUNDLE_ID,
      },
      pipeline: buildPipelineDeps(env),
    });
    return app.fetch(req);
  },

  async scheduled(_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    const deps = buildPipelineDeps(env);
    if (!deps) return;
    ctx.waitUntil(runTick(deps).catch((e) => console.error("pipeline tick failed:", e)));
  },
};
