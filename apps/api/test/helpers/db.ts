import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../../src/db/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function makeTestDb() {
  const pg = new PGlite();
  const dir = join(__dirname, "../../drizzle");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    // drizzle separates statements with "--> statement-breakpoint"
    for (const stmt of readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  const db = drizzle(pg, { schema });
  return { db, pg };
}

export async function seedRound(
  db: Awaited<ReturnType<typeof makeTestDb>>["db"],
  opts: { date: string; opensAt: Date; locksAt: Date },
) {
  await db.insert(schema.rounds).values({ date: opts.date, status: "open" });
  const rows = await db
    .insert(schema.questions)
    .values(
      [1, 2, 3, 4, 5].map((slot) => ({
        roundDate: opts.date,
        slot,
        isBigOne: slot === 5,
        text: `Question ${slot}?`,
        category: "news" as const,
        resolutionCriteria: "per test",
        sourceName: "test",
        opensAt: opts.opensAt,
        locksAt: opts.locksAt,
        resolveBy: new Date(opts.locksAt.getTime() + 86_400_000),
        status: "open" as const,
      })),
    )
    .returning({ id: schema.questions.id, slot: schema.questions.slot });
  return rows;
}
