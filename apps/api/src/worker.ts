import { createApp } from "./app";
// TODO(task-8): replace with import { makeDb } from "./db/client"
const makeDb = (_: string) => null as unknown;

interface WorkerEnv {
  DATABASE_URL: string;
  DEVICE_TOKEN_SECRET: string;
  ADMIN_SECRET: string;
}

export default {
  fetch(req: Request, env: WorkerEnv) {
    const app = createApp({
      db: makeDb(env.DATABASE_URL),
      env: { DEVICE_TOKEN_SECRET: env.DEVICE_TOKEN_SECRET, ADMIN_SECRET: env.ADMIN_SECRET },
    });
    return app.fetch(req);
  },
};
