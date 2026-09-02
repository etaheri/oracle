import { and, eq, inArray, lt } from "drizzle-orm";
import { COPY_BANK, CONSTANTS, fillSlots, selectLine, type Requirement } from "@oracle/core";
import { schema, type Db } from "../db/client";

// The hinge push (voice spec §4): one line per player when the round resolves
// — the second of the day's two dopamine hits, and the only thing that brings
// a lapsed player back. Deterministic: selectLine hashes userId+date, so a
// re-run composes the identical batch and a retried settle is safe.
//
// The four Plan-4 obligations named in this file's old header are now met
// here rather than deferred to a trigger that never arrived:
//
//   1. LAPSED AT MOST ONCE PER LAPSE. The lapsed line fires only on the
//      TRANSITION into silence — the player answered the previous round and
//      not this one. A second, third and thirtieth consecutive miss compose
//      nothing, with no marker column needed: the previous round's own
//      predictions are the marker.
//   2. ONLY AFTER THE ROUND RESOLVED. The audience is drawn from
//      users.streak_settled_through, which settleRound writes as it settles
//      each user — so a batch can only exist for a round that has settled.
//   3. PER-USER RESOLUTION STATE. "results" is satisfied by this player
//      having at least one call that actually scored; an all-void day no
//      longer claims the ledger read them.
//   4. BOUNDED AUDIENCE. users.findMany() would push to every install that
//      ever existed, forever. The audience is exactly settleRound's own —
//      the round's players plus the standing streak holders — which that
//      function has already stamped for us.
const NOON = COPY_BANK.filter((l) => l.pool === "noon");
const NOON_PLAYED = NOON.filter((l) => !l.requires?.includes("lapsed"));
const NOON_LAPSED = NOON.filter((l) => l.requires?.includes("lapsed"));

export interface HingePush {
  userId: string;
  /** OneSignal aliases: this user's device ids. The client logs in as its
   *  device id, not its user id — see notifications/onesignal.ts. Empty for a
   *  user whose devices are gone (struck record); such a push is not sent. */
  externalIds: string[];
  lineId: string;
  text: string;
}

export async function composeHingePushes(db: Db, date: string): Promise<HingePush[]> {
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const qById = new Map(qs.map((q) => [q.id, q]));
  const preds = qs.length
    ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) })
    : [];

  // Obligation 4: settleRound stamps every user it touched — the round's
  // players plus the streak holders — and nobody else.
  const audience = await db.query.users.findMany({ where: eq(schema.users.streakSettledThrough, date) });
  if (audience.length === 0) return [];
  const audienceIds = audience.map((u) => u.id);

  // Obligation 1: who answered the round before this one. A player is only
  // told they lapsed on the day the silence starts.
  const previous = await db.query.rounds.findFirst({
    where: lt(schema.rounds.date, date),
    orderBy: (rounds, { desc }) => [desc(rounds.date)],
  });
  const playedPrevious = new Set<string>();
  if (previous) {
    const prevQs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, previous.date) });
    if (prevQs.length > 0) {
      const prevPreds = await db.query.predictions.findMany({
        where: and(
          inArray(schema.predictions.questionId, prevQs.map((q) => q.id)),
          inArray(schema.predictions.userId, audienceIds),
        ),
      });
      for (const p of prevPreds) playedPrevious.add(p.userId);
    }
  }

  const devices = await db.query.devices.findMany({ where: inArray(schema.devices.userId, audienceIds) });
  const aliasesOf = new Map<string, string[]>();
  for (const d of devices) aliasesOf.set(d.userId, [...(aliasesOf.get(d.userId) ?? []), d.id]);

  const byUser = new Map<string, typeof preds>();
  for (const p of preds) {
    const list = byUser.get(p.userId) ?? [];
    list.push(p);
    byUser.set(p.userId, list);
  }

  const out: HingePush[] = [];
  for (const u of audience) {
    const mine = byUser.get(u.id) ?? [];
    const seedKey = `${u.id}:${date}`;
    const externalIds = aliasesOf.get(u.id) ?? [];

    if (mine.length === 0) {
      // Obligation 1: silence that started today, not silence that continues.
      if (!playedPrevious.has(u.id)) continue;
      const line = selectLine(NOON_LAPSED, seedKey, ["lapsed"]);
      if (line) out.push({ userId: u.id, externalIds, lineId: line.id, text: fillSlots(line.text, {}) });
      continue;
    }

    let wrong = 0;
    let tideWin = false;
    // Obligation 3: did THIS player have anything actually scored today?
    let scored = false;
    for (const p of mine) {
      const q = qById.get(p.questionId);
      if (!q || q.outcome === null || q.outcome === "void") continue;
      scored = true;
      const correct = p.answer === (q.outcome === "yes");
      if (!correct) wrong++;
      const crowd = q.crowdYesPct === null ? null : Number(q.crowdYesPct);
      const sidePct = crowd === null ? null : p.answer ? crowd : 100 - crowd;
      // Mirror the engine's contrarian rule, crowd floor included — a push
      // must never celebrate a bounty the ledger did not pay.
      if (correct && sidePct !== null && q.crowdCount !== null && sidePct < CONSTANTS.CONTRARIAN_CROWD_PCT && q.crowdCount >= CONSTANTS.CONTRARIAN_MIN_CROWD) {
        tideWin = true;
      }
    }
    const satisfied: Requirement[] = [];
    if (scored) satisfied.push("results");
    if (tideWin) satisfied.push("tideWin");
    if (u.streakCurrent >= 2) satisfied.push("streak");
    if (wrong >= 1) satisfied.push("wrong");
    const line = selectLine(NOON_PLAYED, seedKey, satisfied);
    if (line) out.push({ userId: u.id, externalIds, lineId: line.id, text: fillSlots(line.text, { n: wrong, streak: u.streakCurrent }) });
  }
  return out;
}
