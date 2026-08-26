import { eq, inArray } from "drizzle-orm";
import { COPY_BANK, CONSTANTS, fillSlots, selectLine, type Requirement } from "@oracle/core";
import { schema, type Db } from "../db/client";

// The hinge push (voice spec §4): one line per user when the round resolves.
// Deterministic — selectLine hashes userId+date, so a re-run composes the
// identical batch (safe to retry). The TRIGGER is Plan-4 cron work; nothing
// in production calls this yet.
const NOON = COPY_BANK.filter((l) => l.pool === "noon");
const NOON_PLAYED = NOON.filter((l) => !l.requires?.includes("lapsed"));
const NOON_LAPSED = NOON.filter((l) => l.requires?.includes("lapsed"));

export async function composeHingePushes(db: Db, date: string) {
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const resolved = qs.filter((q) => q.outcome !== null && q.outcome !== "void");
  const preds = qs.length
    ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) })
    : [];
  const users = await db.query.users.findMany();
  const qById = new Map(qs.map((q) => [q.id, q]));
  const byUser = new Map<string, typeof preds>();
  for (const p of preds) {
    const list = byUser.get(p.userId) ?? [];
    list.push(p);
    byUser.set(p.userId, list);
  }

  const out: Array<{ userId: string; lineId: string; text: string }> = [];
  for (const u of users) {
    const mine = byUser.get(u.id) ?? [];
    const seedKey = `${u.id}:${date}`;
    if (mine.length === 0) {
      const line = selectLine(NOON_LAPSED, seedKey, ["lapsed"]);
      if (line) out.push({ userId: u.id, lineId: line.id, text: fillSlots(line.text, {}) });
      continue;
    }
    let wrong = 0;
    let tideWin = false;
    for (const p of mine) {
      const q = qById.get(p.questionId);
      if (!q || q.outcome === null || q.outcome === "void") continue;
      const correct = p.answer === (q.outcome === "yes");
      if (!correct) wrong++;
      const crowd = q.crowdYesPct === null ? null : Number(q.crowdYesPct);
      const sidePct = crowd === null ? null : p.answer ? crowd : 100 - crowd;
      if (correct && sidePct !== null && sidePct < CONSTANTS.CONTRARIAN_CROWD_PCT) tideWin = true;
    }
    const hasResults = resolved.length > 0;
    const satisfied: Requirement[] = [];
    if (hasResults) satisfied.push("results");
    if (tideWin) satisfied.push("tideWin");
    if (u.streakCurrent >= 2) satisfied.push("streak");
    if (wrong >= 1) satisfied.push("wrong");
    const line = selectLine(NOON_PLAYED, seedKey, satisfied);
    if (line) out.push({ userId: u.id, lineId: line.id, text: fillSlots(line.text, { n: wrong, streak: u.streakCurrent }) });
  }
  return out;
}
