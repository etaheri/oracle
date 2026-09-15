import { Hono } from "hono";
import { count, inArray, isNotNull } from "drizzle-orm";
import { CONSTANTS, designation, disambiguate } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

// The all-time board (design §7, §8.3; 2026-09-14 §6.6): every player who has
// settled at least one stake, ranked by the best fortune they have ever
// reached. A bust restarts the fortune, not the record: ranking on the live
// fortune would drop a veteran under a newcomer the morning after. Same floor
// and window as the daily board; designations only.
export const boardRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/all-time", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const staked = await db
      .select({ userId: schema.predictions.userId, n: count() })
      .from(schema.predictions)
      .where(isNotNull(schema.predictions.payout))
      .groupBy(schema.predictions.userId);
    const ids = staked.map((r) => r.userId);
    const users = ids.length ? await db.query.users.findMany({ where: inArray(schema.users.id, ids) }) : [];
    const entries = users.map((u) => ({ userId: u.id, best: u.bestFortune }));
    const field = entries.map((e) => e.best);
    const mine = entries.find((e) => e.userId === userId)?.best ?? null;
    const empty = { field_size: field.length, your_best: mine, your_rank: null as number | null, best: null as number | null, median_best: null as number | null, rows: [] as Array<{ name: string; best: number; rank: number; is_you: boolean }> };
    if (field.length < CONSTANTS.BOARD_MIN_FIELD) return c.json(empty);
    const sorted = [...field].sort((a, b) => b - a);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
    // Ties share the better rank: one plus the number of strictly richer players.
    const rankIn = (f: number) => 1 + field.filter((x) => x > f).length;
    const ranked = entries.map((e) => ({ ...e, rank: rankIn(e.best), is_you: e.userId === userId })).sort((a, b) => b.best - a.best);
    const meIdx = ranked.findIndex((r) => r.is_you);
    const keep = new Set<number>();
    for (let i = 0; i < Math.min(CONSTANTS.BOARD_TOP_ROWS, ranked.length); i++) keep.add(i);
    if (meIdx >= 0) for (let i = meIdx - CONSTANTS.BOARD_NEIGHBOURS; i <= meIdx + CONSTANTS.BOARD_NEIGHBOURS; i++) if (i >= 0 && i < ranked.length) keep.add(i);
    const shown = [...keep].sort((a, b) => a - b).map((i) => ranked[i]!);
    const names = disambiguate(shown.map((r) => designation(r.userId)));
    return c.json({
      ...empty,
      your_rank: mine === null ? null : rankIn(mine),
      best: sorted[0]!,
      median_best: median,
      rows: shown.map((r, i) => ({ name: names[i]!, best: r.best, rank: r.rank, is_you: r.is_you })),
    });
  });
