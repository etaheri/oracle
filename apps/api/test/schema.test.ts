import { describe, it, expect } from "vitest";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";

describe("schema + harness", () => {
  it("migrates, seeds a round with 5 questions, and enforces the unique prediction index", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    expect(qs).toHaveLength(5);

    const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
    const pred = { questionId: qs[0]!.id, userId: user!.id, answer: true, confidence: 75 };
    await db.insert(schema.predictions).values(pred);
    await expect(db.insert(schema.predictions).values(pred)).rejects.toThrow(); // unique index
  });

  it("0003: crowd_count, oracle_p_yes, device ip throttle columns, draft bank, indexes", async () => {
    const { pg } = await makeTestDb();
    const cols = async (table: string) =>
      (await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = $1`, [table])).rows.map((r) => r.column_name);
    expect(await cols("questions")).toEqual(expect.arrayContaining(["crowd_count", "oracle_p_yes"]));
    expect(await cols("devices")).toEqual(expect.arrayContaining(["ip_hash", "created_at"]));
    expect(await cols("draft_bank")).toEqual(expect.arrayContaining(["id", "draft", "created_at", "used_on"]));
    const idx = (await pg.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(["predictions_user_idx", "questions_round_date_idx", "users_oracle_score_idx", "devices_ip_hash_idx"]));
  });
});
