// Public and unauthenticated (design 2026-09-11 §13, C3): the proof that the
// man-versus-machine claim is true, and the dataset. No device token, no
// CORS — nothing fetches this from a browser on another origin.
import { Hono } from "hono";
import type { AppContext } from "../app";
import { loadSettledCalls, standings, standingsCsv, standingsHtml } from "../standings";

const CACHE = "public, max-age=300";

export const standingsRoutes = new Hono<AppContext>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const calls = await loadSettledCalls(db);
    if (c.req.query("format") === "csv") {
      return c.body(standingsCsv(calls), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="outsee-standings.csv"',
        "cache-control": CACHE,
      });
    }
    return c.json(standings(calls, new Date()), 200, { "cache-control": CACHE });
  });

export const standingsPage = new Hono<AppContext>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const calls = await loadSettledCalls(db);
    return c.html(standingsHtml(standings(calls, new Date())), 200, { "cache-control": CACHE });
  });
