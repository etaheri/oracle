import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export function makeDb(url: string) {
  return drizzle(neon(url), { schema });
}
// Widened to the common drizzle base type (rather than the Neon-specific driver return type)
// so that other PgDatabase-backed drivers — e.g. the PGlite instance used in tests — satisfy
// this type too. Route code only relies on the shared query-builder API (`db.query.*`,
// `db.insert(...)`, etc.), which is defined on this base class for every driver.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };
