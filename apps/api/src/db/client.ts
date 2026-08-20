import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export function makeDb(url: string) {
  return drizzle(neon(url), { schema });
}
export type Db = ReturnType<typeof makeDb>;
export { schema };
