import { and, eq, inArray, isNull, lt } from "drizzle-orm";
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
      if (!q || q.outcome === null || q.outcome === "void" || p.points === null) continue;
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

const RESOLVE = COPY_BANK.filter((l) => l.pool === "resolve");
const HEADLINE_MAX = 70;

export interface ResolutionPush {
  userId: string;
  predictionId: string;
  externalIds: string[];
  lineId: string;
  text: string;
}

// The question, in the reader's register (sentence case, as authored), cut
// to a headline. The caps line that follows is the push's own voice.
export function headline(text: string): string {
  const t = text.trim();
  return t.length <= HEADLINE_MAX ? t : `${t.slice(0, HEADLINE_MAX - 1).trimEnd()}…`;
}

function signed(points: number | null): string {
  if (points === null || points === 0) return "0";
  return points > 0 ? `+${points}` : String(points);
}

// The trickle (design 2026-09-09 §2.1): one push per (player, question) the
// moment a question resolves yes/no. THE CLAIM IS THE IDEMPOTENCY — one UPDATE
// stamps resolve_pushed_at on every unclaimed row and returns exactly those,
// so the hourly re-dispatch, a crashed step's replay, and two ticks racing
// on the same question all compose each push at most once. State-based on
// purpose: it reads the question's outcome, not a caller's "I just resolved
// it" flag, so a resolve whose step never checkpointed still gets its push
// on the next pass.
export async function claimResolutionPushes(db: Db, questionId: string, now: Date): Promise<ResolutionPush[]> {
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q || q.outcome === null || q.outcome === "void") return [];

  const claimed = await db
    .update(schema.predictions)
    .set({ resolvePushedAt: now })
    .where(and(eq(schema.predictions.questionId, questionId), isNull(schema.predictions.resolvePushedAt)))
    .returning();
  if (claimed.length === 0) return [];

  const userIds = [...new Set(claimed.map((p) => p.userId))];
  const devices = await db.query.devices.findMany({ where: inArray(schema.devices.userId, userIds) });
  const aliasesOf = new Map<string, string[]>();
  for (const d of devices) aliasesOf.set(d.userId, [...(aliasesOf.get(d.userId) ?? []), d.id]);

  const outcome = q.outcome === "yes" ? "YES" : "NO";
  const head = headline(q.text);
  return claimed.map((p) => {
    const line = selectLine(RESOLVE, `${p.userId}:${questionId}`, ["outcome", "call", "points"])!;
    const call = `${p.answer ? "YES" : "NO"} AT ${p.confidence}%`;
    return {
      userId: p.userId,
      predictionId: p.id,
      externalIds: aliasesOf.get(p.userId) ?? [],
      lineId: line.id,
      text: `${head} ${fillSlots(line.text, { outcome, call, points: signed(p.points) })}`,
    };
  });
}
