import { Hono } from "hono";
import type { Db } from "./db/client";
export type { Db };
export interface AppEnv {
  DEVICE_TOKEN_SECRET: string;
  ADMIN_SECRET: string;
}
export interface Deps { db: Db; env: AppEnv; }
export type AppContext = { Variables: { deps: Deps } };

export function createApp(deps: Deps) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });
  app.get("/v1/health", (c) => c.json({ ok: true }));
  return app;
}
