import { Hono } from "hono";
import type { Db } from "./db/client";
import { authRoutes } from "./routes/auth";
import { roundRoutes } from "./routes/round";
import { predictionRoutes } from "./routes/predictions";
import { adminRoutes } from "./routes/admin";
import { meRoutes } from "./routes/me";
import { telegramRoutes } from "./routes/telegram";
import { webhookRoutes } from "./routes/webhooks";
import type { PipelineDeps } from "./pipeline";
export type { Db };
export interface AppEnv {
  DEVICE_TOKEN_SECRET: string;
  ADMIN_SECRET: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CHAT_ID?: string;
  REVENUECAT_WEBHOOK_SECRET?: string;
  APPLE_BUNDLE_ID?: string;
}
export interface Deps {
  db: Db;
  env: AppEnv;
  pipeline?: PipelineDeps;
  verifyApple?: (token: string, opts: { audience: string }) => Promise<{ sub: string } | null>;
}
export type AppContext = { Variables: { deps: Deps; userId: string; deviceId: string } };

export function createApp(deps: Deps) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });
  app.get("/v1/health", (c) => c.json({ ok: true }));
  app.route("/v1/auth", authRoutes);
  app.route("/v1/round", roundRoutes);
  app.route("/v1/predictions", predictionRoutes);
  app.route("/v1/me", meRoutes);
  app.route("/admin", adminRoutes);
  app.route("/v1/telegram", telegramRoutes);
  app.route("/v1/webhooks", webhookRoutes);
  return app;
}
