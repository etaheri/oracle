import { Hono } from "hono";
import { count, inArray, isNotNull } from "drizzle-orm";
import { CONSTANTS, designation, disambiguate } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

// The all-time board (design §7, §8.3): every player who has settled at least
// one stake, ranked by fortune. A player who has never staked stands at
// founding and is not in the field -- a board of untouched 1,000s ranks
// nobody. Same floor and window as the daily board; same designations, so
// nothing a user typed reaches the rows.
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
    const entries = users.map((u) => ({ userId: u.id, fortune: u.fortune }));
    const field = entries.map((e) => e.fortune);
    const mine = entries.find((e) => e.userId === userId)?.fortune ?? null;
    const empty = { field_size: field.length, your_fortune: mine, your_rank: null as number | null, best_fortune: null as number | null, median_fortune: null as number | null, rows: [] as Array<{ name: string; fortune: number; rank: number; is_you: boolean }> };
    if (field.length < CONSTANTS.BOARD_MIN_FIELD) return c.json(empty);
    const sorted = [...field].sort((a, b) => b - a);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
    // Ties share the better rank: one plus the number of strictly richer players.
    const rankIn = (f: number) => 1 + field.filter((x) => x > f).length;
    const ranked = entries.map((e) => ({ ...e, rank: rankIn(e.fortune), is_you: e.userId === userId })).sort((a, b) => b.fortune - a.fortune);
    const meIdx = ranked.findIndex((r) => r.is_you);
    const keep = new Set<number>();
    for (let i = 0; i < Math.min(CONSTANTS.BOARD_TOP_ROWS, ranked.length); i++) keep.add(i);
    if (meIdx >= 0) for (let i = meIdx - CONSTANTS.BOARD_NEIGHBOURS; i <= meIdx + CONSTANTS.BOARD_NEIGHBOURS; i++) if (i >= 0 && i < ranked.length) keep.add(i);
    const shown = [...keep].sort((a, b) => a - b).map((i) => ranked[i]!);
    const names = disambiguate(shown.map((r) => designation(r.userId)));
    return c.json({
      ...empty,
      your_rank: mine === null ? null : rankIn(mine),
      best_fortune: sorted[0]!,
      median_fortune: median,
      rows: shown.map((r, i) => ({ name: names[i]!, fortune: r.fortune, rank: r.rank, is_you: r.is_you })),
    });
  });
