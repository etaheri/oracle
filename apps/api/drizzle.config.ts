import { defineConfig } from "drizzle-kit";
// DATABASE_URL is only needed for `db:migrate`/`db:push`; `db:generate` is
// offline. Source it from apps/api/.dev.vars for dev Neon.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(process.env.DATABASE_URL ? { dbCredentials: { url: process.env.DATABASE_URL } } : {}),
});
