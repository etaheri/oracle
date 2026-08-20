import { Hono } from "hono";
import type { Db } from "./db/client";
import { authRoutes } from "./routes/auth";
import { roundRoutes } from "./routes/round";
import { predictionRoutes } from "./routes/predictions";
import { adminRoutes } from "./routes/admin";
export type { Db };
export interface AppEnv {
  DEVICE_TOKEN_SECRET: string;
  ADMIN_SECRET: string;
}
export interface Deps { db: Db; env: AppEnv; }
export type AppContext = { Variables: { deps: Deps; userId: string } };

export function createApp(deps: Deps) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });
  app.get("/v1/health", (c) => c.json({ ok: true }));
  app.route("/v1/auth", authRoutes);
  app.route("/v1/round", roundRoutes);
  app.route("/v1/predictions", predictionRoutes);
  app.route("/admin", adminRoutes);
  return app;
}
