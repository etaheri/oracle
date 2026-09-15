import { Hono } from "hono";
import { asc, and, count, countDistinct, eq, inArray, sum } from "drizzle-orm";
import { ratingEligible, oracleQuestionPoints, CONSTANTS, dayPoints, dayReturn, weighDay, designation, disambiguate, ORACLE_DESIGNATION, oracleDayTotal, onRightSide, MEMBER_ORDER } from "@oracle/core";
import type { AppContext } from "../app";
import { schema, type Db } from "../db/client";
import { deviceAuth } from "./auth";
import { evidenceSummary } from "../resolution";
import { noonET } from "../pipeline/clock";
import { selectExhibition } from "../exhibition";
import { houseSummary } from "../house";

// The live round: earliest open round whose latest question lock is still
// ahead of the server clock. The cron flips statuses on a 10-minute tick;
// the clock is authoritative in between (predictions.ts already enforces it).
async function openRound(db: Db, now: Date) {
  const rounds = await db.query.rounds.findMany({ where: eq(schema.rounds.status, "open"), orderBy: [asc(schema.rounds.date)] });
  for (const round of rounds) {
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, round.date), orderBy: [asc(schema.questions.slot)] });
    const lastLock = qs.reduce((m, q) => Math.max(m, q.locksAt.getTime()), 0);
    if (qs.length > 0 && now.getTime() < lastLock) return { round, qs, lastLock: new Date(lastLock) };
  }
  return null;
}

export const roundRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/today", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const found = await openRound(db, new Date());
    if (!found) return c.json({ error: "no open round" }, 404);
    const { round, qs, lastLock } = found;
    // rounds.player_count is a dead column (never written); the live count is
    // distinct predictors on this round, same source of truth as /today/crowd.
    const qIds = qs.map((q) => q.id);
    const [players] = qIds.length
      ? await db.select({ n: countDistinct(schema.predictions.userId) }).from(schema.predictions).where(inArray(schema.predictions.questionId, qIds))
      : [{ n: 0 }];
    // The purse and the house (design 2026-09-10 §7). The house total is every
    // settled round's delta since founding; last_delta is the newest of them,
    // null while no round has settled. Both are read as aggregates: the row
    // set grows by one a day forever, and /today is the hottest route we
    // serve, so neither may become an unbounded select summed in JavaScript.
    const [user, house] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      houseSummary(db),
    ]);
    return c.json({
      date: round.date,
      rules_version: round.rulesVersion,
      locks_at: lastLock.toISOString(),
      player_count: Number(players?.n ?? 0),
      fortune: user?.fortune ?? null,
      house,
      questions: qs.map((q) => ({
        id: q.id,
        slot: q.slot,
        is_big_one: q.isBigOne,
        text: q.text,
        category: q.category,
        source_name: q.sourceName,
        resolution_criteria: q.resolutionCriteria,
        context: q.context,
        locks_at: q.locksAt.toISOString(),
        lock_healed: q.lockHealedAt !== null,
        // Struck for everyone (v2): lock healed OR withdrawn by the operator.
        // The client gates the required set on this; lock_healed above stays a
        // faithful record of what the retired probe wrote, never widened to
        // mean "struck", so historical rounds keep their meaning.
        struck: q.lockHealedAt !== null || q.withdrawnAt !== null,
        struck_reason: q.lockHealedAt !== null || q.withdrawnAt !== null ? (evidenceSummary(q.resolutionEvidence).reason ?? null) : null,
        line_p_yes: q.linePYes === null ? null : Number(q.linePYes),
      })),
    });
  })
  .get("/today/crowd", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const found = await openRound(db, new Date());
    if (!found) return c.json({ error: "no open round" }, 404);
    const { qs } = found;
    const qIds = qs.map((q) => q.id);
    const preds = qIds.length
      ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qIds) })
      : [];
    const mine = new Set(preds.filter((p) => p.userId === userId).map((p) => p.questionId));
    const questions = [...mine].map((qid) => {
      const ofQ = preds.filter((p) => p.questionId === qid);
      const yes = ofQ.filter((p) => p.answer).length;
      return { id: qid, crowd_yes_pct: Math.round((100 * yes) / ofQ.length), player_count: ofQ.length };
    });
    return c.json({ questions });
  })
  .get("/today/mine", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const found = await openRound(db, new Date());
    if (!found) return c.json({ error: "no open round" }, 404);
    const { round, qs } = found;
    const [mine, stamped] = await Promise.all([
      qs.length
        ? db.query.predictions.findMany({
            where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qs.map((q) => q.id))),
          })
        : Promise.resolve([]),
      db.query.userRounds.findFirst({ where: and(eq(schema.userRounds.userId, userId), eq(schema.userRounds.date, round.date)) }),
    ]);
    return c.json({
      // The round's double (design 2026-09-14 §6.3): null until placed.
      double_question_id: stamped?.doubleQuestionId ?? null,
      predictions: mine.map((p) => ({
        question_id: p.questionId,
        answer: p.answer,
        confidence: p.confidence,
        crowd_yes_pct_at_seal: p.crowdYesPctAtSeal === null ? null : Number(p.crowdYesPctAtSeal),
        crowd_count_at_seal: p.crowdCountAtSeal,
        stake: p.stake,
        doubled: p.doubled,
      })),
    });
  })
  .get("/next", async (c) => {
    const { db } = c.get("deps");
    const next = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "scheduled"), orderBy: [asc(schema.rounds.date)] });
    if (!next) return c.json({ error: "no round scheduled" }, 404);
    return c.json({ date: next.date, opens_at: noonET(next.date).toISOString() });
  })
  .get("/exhibition", async (c) => {
    const exhibition = await selectExhibition(c.get("deps").db);
    if (!exhibition) return c.json({ error: "no exhibition available" }, 404);
    return c.json(exhibition);
  })
  .get("/:date/reveal", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const date = c.req.param("date");
    const qs = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, date),
      orderBy: [asc(schema.questions.slot)],
    });
    if (qs.length === 0) return c.json({ error: "unknown round" }, 404);
    const now = Date.now();
    const settledEnough = qs.every((q) => q.status === "locked" || q.status === "resolved" || q.status === "void" || now >= q.locksAt.getTime());
    if (!settledEnough) return c.json({ error: "not locked" }, 409);

    const [round, user] = await Promise.all([
      db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) }),
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    ]);
    const qIds = qs.map((q) => q.id);
    const [mine, councilRows, pack] = await Promise.all([
      db.query.predictions.findMany({ where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qIds)) }),
      // The Council and its evidence (design 2026-09-11 §13). Only here, after
      // lock: before it, the split is information and the house line is the
      // one line the player plays against.
      db.query.lines.findMany({ where: inArray(schema.lines.questionId, qIds) }),
      db.query.evidence.findMany({ where: inArray(schema.evidence.questionId, qIds), orderBy: [asc(schema.evidence.questionId), asc(schema.evidence.rank)] }),
    ]);
    const memberRank = (m: string) => { const i = MEMBER_ORDER.indexOf(m as (typeof MEMBER_ORDER)[number]); return i === -1 ? MEMBER_ORDER.length : i; };
    const council = qs.flatMap((q) =>
      councilRows.filter((l) => l.questionId === q.id).sort((a, b) => memberRank(a.member) - memberRank(b.member)).map((l) => ({
        question_id: q.id,
        member: l.member,
        p_yes: Number(l.pYes),
        on_right_side: onRightSide(Number(l.pYes), q.outcome),
        reasoning: l.reasoning,
        cited: l.cited,
        lessons_received: l.lessonsReceived.length,
      })),
    );
    const evidence = pack.map((e) => ({
      question_id: e.questionId, rank: e.rank, url: e.url, title: e.title, source: e.source,
      published_at: e.publishedAt === null ? null : e.publishedAt.toISOString(), highlight: e.highlight,
    }));
    const byQ = new Map(mine.map((p) => [p.questionId, p]));
    const perQuestionPoints = mine.map((p) => p.points ?? 0);
    const allFirstHour = mine.length === qs.length && mine.every((p) => p.firstHour);
    const base = mine.reduce((total, p) => {
      const q = qs.find(q => q.id === p.questionId)!;
      return total + (q.outcome === null ? 0 : oracleQuestionPoints({ pYes: p.answer ? p.confidence / 100 : 1 - p.confidence / 100, outcome: q.outcome, isBigOne: q.isBigOne }));
    }, 0);
    const raw = round && round.rulesVersion >= 2 ? base : dayPoints(perQuestionPoints, allFirstHour);
    // The vigil that weighed this day, stamped at settlement. Absent means
    // unweighed, not weightless: the client withholds the number entirely
    // rather than print one that would climb on the next refresh.
    const stamped = await db.query.userRounds.findFirst({
      where: and(eq(schema.userRounds.userId, userId), eq(schema.userRounds.date, date)),
    });
    const vigilMult = stamped ? Number(stamped.vigilMult) : null;

    // The round's fortune figures (design 2026-09-10 §7). Only a version 3
    // round has stakes, so every figure below is null before it. `return` is
    // divided by the fortune at the player's FIRST seal of the day, stamped on
    // user_rounds, so a later round's winnings never re-scale this one.
    //
    // WITHHELD UNTIL EVERY CARD IS DECIDED, the way vigil_mult is withheld
    // above. This route admits a round from LOCK, but payouts land one
    // question at a time: quoted mid-resolution, `delta` would be a partial
    // sum, `return` would divide that partial over the whole day's fortune,
    // and `fortune_after` would be a balance still being paid into. A number
    // that climbs on the next refresh is the same broken promise as a
    // provisional rank -- the client withholds the line rather than print one.
    const decided = qs.every((q) => q.outcome !== null);
    const staked = mine.filter((p) => p.stake !== null && p.payout !== null);
    const deltas = staked.map((p) => p.payout! - p.stake!);
    const v3 = (round?.rulesVersion ?? 1) >= 3 && decided;
    const roundDelta = v3 && staked.length > 0 ? deltas.reduce((a, b) => a + b, 0) : null;

    // The bust (design 2026-09-14 §6.4): stamped on user_rounds by settlement
    // with the fortune the house took it at. The reveal shows that number as
    // fortune_after rather than the new thousand the player wakes up to.
    const bustFortune = v3 ? (stamped?.bustFortune ?? null) : null;

    return c.json({
      date,
      rules_version: round?.rulesVersion ?? 1,
      delta: roundDelta,
      return: v3 && stamped?.fortuneAtOpen ? dayReturn(deltas, stamped.fortuneAtOpen) : null,
      // The caller's fortune as it stands, which equals the post-round fortune
      // until a later round settles. /me/ledger carries the exact per-round
      // value. A bust shows the fortune the house took it at instead — the
      // player has already woken up to the new thousand by the time they
      // read this.
      fortune_after: v3 ? (bustFortune ?? user?.fortune ?? null) : null,
      house_delta: v3 ? (round?.houseDelta ?? null) : null,
      // Non-null means this round busted the caller, at this fortune.
      bust_fortune: bustFortune,
      bonus_points: round && round.rulesVersion >= 2 ? perQuestionPoints.reduce((a, b) => a + b, 0) - base : 0,
      day_points: vigilMult === null ? raw : weighDay(raw, vigilMult),
      vigil_mult: vigilMult,
      first_hour: allFirstHour,
      candidates_written: round?.candidatesWritten ?? 0,
      candidates_rejected: round?.candidatesRejected ?? 0,
      council,
      evidence,
      questions: qs.map((q) => {
        const p = byQ.get(q.id);
        const ev = evidenceSummary(q.resolutionEvidence);
        return {
          id: q.id,
          slot: q.slot,
          text: q.text,
          outcome: q.outcome,
          crowd_yes_pct: q.crowdYesPct === null ? null : Number(q.crowdYesPct),
          // How many actually spoke on this question. The reveal needs it to
          // hold its tongue at tiny crowd sizes the way the round footer and
          // the finale already do (audit 2026-09-02 §2.1) — a percentage over
          // three players is mostly the reader.
          crowd_count: q.crowdCount,
          market_prob: q.marketProb === null ? null : Number(q.marketProb),
          line_p_yes: q.linePYes === null ? null : Number(q.linePYes),
          my: p
            ? {
                answer: p.answer,
                confidence: p.confidence,
                points: p.points,
                brier: p.brier === null ? null : Number(p.brier),
                crowd_yes_pct_at_seal: p.crowdYesPctAtSeal === null ? null : Number(p.crowdYesPctAtSeal),
                crowd_count_at_seal: p.crowdCountAtSeal,
                stake: p.stake,
                payout: p.payout,
                delta: p.payout === null || p.stake === null ? null : p.payout - p.stake,
                doubled: p.doubled,
              }
            : null,
          source_name: q.sourceName,
          source_url: q.sourceUrl,
          evidence_quote: ev.quote,
          evidence_url: ev.quoteUrl,
          void_reason: q.outcome === "void" ? (ev.reason ?? "UNVERIFIABLE") : null,
          oracle_p_yes: q.oracleProbYes === null ? null : Number(q.oracleProbYes),
        };
      }),
      ledger: {
        settled: round?.status === "resolved",
        streak: user?.streakCurrent ?? 0,
        calls_rated: user?.callsResolved ?? 0,
        oracle_score: user?.oracleScore ?? null,
      },
    });
  })
  // The daily board (design 2026-09-03 §4): where the caller's day stood among
  // everyone who played it. The day, not the record -- it works with one day's
  // play on install day, where the Oracle Score's fifty-call floor cannot.
  // Anonymous aggregates and the caller's own row; no names, ever.
  .get("/:date/board", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const date = c.req.param("date");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
    if (qs.length === 0) return c.json({ error: "unknown round" }, 404);
    // Readable exactly when points exist -- every question carrying an outcome
    // (resolved OR void). While one is unread the day has no total, and a
    // provisional rank is the same broken promise as a provisional score.
    // Same 409 posture /:date/reveal takes on a day that has not locked.
    if (qs.some((q) => q.outcome === null)) return c.json({ error: "not resolved" }, 409);

    const boardRound = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });

    // ─────────────────────────────────────────────────────────────────────
    // VERSION 3: THE FIELD RANKED BY RETURN (design 2026-09-10 §7).
    //
    // A version 3 day is not scored in points at all, so this branch returns
    // before the points recompute below ever runs. What is ranked is the day's
    // RETURN -- Σ(payout − stake) over the fortune the player opened the day
    // with -- carried in basis points so the wire stays integer. THE ORACLE
    // does not stand in this field: the machine has no fortune and takes no
    // stake, so it has no return to rank. Rows still carry `points: 0`, which
    // the schema requires and a version 3 client must ignore.
    // ─────────────────────────────────────────────────────────────────────
    if ((boardRound?.rulesVersion ?? 1) >= 3) {
      const predictions = await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) });
      const opens = await db.query.userRounds.findMany({ where: eq(schema.userRounds.date, date) });
      const openBy = new Map(opens.map((u) => [u.userId, u.fortuneAtOpen]));
      const returns = [...new Set(predictions.map((p) => p.userId))].flatMap((uid) => {
        const played = predictions.filter((p) => p.userId === uid);
        // The same completeness rule every rated surface enforces.
        if (!ratingEligible(3, qs, new Set(played.map((p) => p.questionId)))) return [];
        const base = openBy.get(uid);
        if (!base) return [];
        const deltas = played.filter((p) => p.stake !== null && p.payout !== null).map((p) => p.payout! - p.stake!);
        return [{ userId: uid, bp: Math.round(dayReturn(deltas, base) * 10_000) }];
      });
      const field = returns.map((r) => r.bp);
      const mineBp = returns.find((r) => r.userId === userId)?.bp ?? null;
      const empty = { date, metric: "return" as const, field_size: field.length, your_points: null, your_rank: null, best_points: null, median_points: null, your_return_bp: mineBp, best_return_bp: null, median_return_bp: null, rows: [] as Array<{ name: string; points: number; return_bp: number; rank: number; is_you: boolean; is_oracle: boolean }> };
      // Below the floor the board reports the field's size and nothing else.
      if (field.length < CONSTANTS.BOARD_MIN_FIELD) return c.json(empty);
      const sorted = [...field].sort((a, b) => b - a);
      const mid = sorted.length >> 1;
      // Even fields average the two middles, rounded by MAGNITUDE -- the same
      // symmetry the points board keeps, so a losing field is never quoted
      // cheaper than the winning field of the same size.
      const median = sorted.length % 2 === 1 ? sorted[mid]! : Math.sign((sorted[mid - 1]! + sorted[mid]!) / 2) * Math.round(Math.abs((sorted[mid - 1]! + sorted[mid]!) / 2));
      // Ties share the better rank: one plus the number of strictly better days.
      const rankIn = (bp: number) => 1 + field.filter((x) => x > bp).length;
      const ranked = returns.map((r) => ({ ...r, rank: rankIn(r.bp), is_you: r.userId === userId })).sort((a, b) => b.bp - a.bp);
      // The window: the summit plus the caller's own neighbourhood, merged by
      // index so overlapping windows never repeat a row.
      const meIdx = ranked.findIndex((r) => r.is_you);
      const keep = new Set<number>();
      for (let i = 0; i < Math.min(CONSTANTS.BOARD_TOP_ROWS, ranked.length); i++) keep.add(i);
      if (meIdx >= 0) for (let i = meIdx - CONSTANTS.BOARD_NEIGHBOURS; i <= meIdx + CONSTANTS.BOARD_NEIGHBOURS; i++) if (i >= 0 && i < ranked.length) keep.add(i);
      const shown = [...keep].sort((a, b) => a - b).map((i) => ranked[i]!);
      const names = disambiguate(shown.map((r) => designation(r.userId)));
      return c.json({
        ...empty,
        your_rank: mineBp === null ? null : rankIn(mineBp),
        best_return_bp: sorted[0]!,
        median_return_bp: median,
        rows: shown.map((r, i) => ({ name: names[i]!, points: 0, return_bp: r.bp, rank: r.rank, is_you: r.is_you, is_oracle: false })),
      });
    }

    // RANKED ON RAW PER-QUESTION POINTS -- the single most important line in
    // this route. SUM(predictions.points) is questionPoints output: the big-one
    // multiplier and the contrarian bonus are in it (both earned by the call
    // itself), and the first-hour bonus and the vigil multiplier are NOT (one
    // is a timing edge, the other is defended by a shield that can be BOUGHT).
    // Ranking on day_points would let a purchase buy a longer vigil, a larger
    // multiplier and a higher rank, which is exactly what SCORE_GLOSS promises
    // cannot happen. Money must not buy the board.
    let rows = await db
      .select({ userId: schema.predictions.userId, answered: count(), points: sum(schema.predictions.points) })
      .from(schema.predictions)
      .where(inArray(schema.predictions.questionId, qs.map((q) => q.id)))
      .groupBy(schema.predictions.userId);

    if ((boardRound?.rulesVersion ?? 1) >= 2) {
      const predictions = await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map(q => q.id)) });
      rows = rows.flatMap(row => {
        const played = predictions.filter(p => p.userId === row.userId);
        if (!ratingEligible(2, qs, new Set(played.map(p => p.questionId)))) return [];
        const points = played.reduce((sum, p) => {
          const q = qs.find(q => q.id === p.questionId)!;
          return sum + oracleQuestionPoints({ pYes: p.answer ? p.confidence / 100 : 1 - p.confidence / 100, outcome: q.outcome!, isBigOne: q.isBigOne });
        }, 0);
        return [{ ...row, answered: qs.length, points: String(points) }];
      });
    }

    // Complete rounds only, the same rule /v1/me/ledger and completeRoundBriers
    // enforce: answered every question the round asked. It stops a single easy
    // question being cherry-picked onto the board, and the app already says
    // THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED.
    const field = rows.filter((r) => Number(r.answered) === qs.length).map((r) => Number(r.points ?? 0));
    const mine = rows.find((r) => r.userId === userId);
    const yourPoints = mine && Number(mine.answered) === qs.length ? Number(mine.points ?? 0) : null;

    // Below the floor the board reports the field's size and nothing else.
    if (field.length < CONSTANTS.BOARD_MIN_FIELD) {
      return c.json({ date, metric: "points", field_size: field.length, your_points: yourPoints, your_rank: null, best_points: null, median_points: null, rows: [] });
    }

    const sorted = [...field].sort((a, b) => b - a);
    const mid = sorted.length >> 1;
    // Even fields average the two middles. Rounded by MAGNITUDE, so a field of
    // losing days is never quoted cheaper than the winning field of the same
    // size -- the same symmetry weighDay keeps.
    const median = sorted.length % 2 === 1
      ? sorted[mid]!
      : (() => {
          const m = (sorted[mid - 1]! + sorted[mid]!) / 2;
          return Math.sign(m) * Math.round(Math.abs(m));
        })();

    // THE ORACLE stands in the field. Its day is scored on the same ladder as
    // the rows beside it: the big one's double weight is IN (a call earns it),
    // the contrarian bounty, the first hour and the vigil are OUT (a crowd, a
    // clock and a purchasable shield confer those). oracleQuestionPoints takes
    // no crowd argument at all, so there is no path by which one could reach it.
    const oracleTotal = qs.every((q) => q.oracleProbYes !== null || ((boardRound?.rulesVersion ?? 1) >= 2 && q.outcome === "void"))
      ? oracleDayTotal(
          qs.map((q) => ({
            pYes: Number(q.oracleProbYes),
            outcome: q.outcome as "yes" | "no" | "void",
            isBigOne: q.isBigOne,
          })),
        )
      : null;

    // EVERY ROW IS RANKED AGAINST THE PLAYER FIELD, the machine included.
    //
    // Not against the combined list. `field_size` and `your_rank` are shipped
    // numbers about the human field -- the app already renders RANK 7 OF 9 --
    // and ranking rows against players-plus-machine would silently make a
    // player's row rank disagree with the your_rank printed beside it the
    // moment the Oracle outscored them. So the Oracle's row carries its
    // placing AMONG THE HUMANS: how many players beat it, plus one. A player
    // and the Oracle can therefore share a rank, which is the honest reading
    // of "the machine placed third among you".
    const rankIn = (points: number) => 1 + field.filter((p) => p > points).length;

    const entries: Array<{ userId: string | null; points: number }> = rows
      .filter((r) => Number(r.answered) === qs.length)
      .map((r) => ({ userId: r.userId, points: Number(r.points ?? 0) }));
    if (oracleTotal !== null) entries.push({ userId: null, points: oracleTotal });
    entries.sort((a, b) => b.points - a.points);
    const ranked = entries.map((e) => ({
      ...e,
      rank: rankIn(e.points),
      is_you: e.userId === userId,
      is_oracle: e.userId === null,
    }));

    // The window: the summit, plus the caller's own neighbourhood, plus the
    // machine wherever it landed -- a reader should never have to scroll to
    // find out where the Oracle placed. Indices, then one pass, so overlapping
    // windows merge instead of repeating a row.
    const meIdx = ranked.findIndex((r) => r.is_you);
    const keep = new Set<number>();
    for (let i = 0; i < Math.min(CONSTANTS.BOARD_TOP_ROWS, ranked.length); i++) keep.add(i);
    if (meIdx >= 0) {
      for (let i = meIdx - CONSTANTS.BOARD_NEIGHBOURS; i <= meIdx + CONSTANTS.BOARD_NEIGHBOURS; i++) {
        if (i >= 0 && i < ranked.length) keep.add(i);
      }
    }
    const oracleIdx = ranked.findIndex((r) => r.is_oracle);
    if (oracleIdx >= 0) keep.add(oracleIdx);

    // `shown`, not `window` -- the latter shadows a global and reads badly.
    const shown = [...keep].sort((a, b) => a - b).map((i) => ranked[i]!);
    // Designations are assigned, never chosen -- nothing a user typed is
    // stored or rendered here, which is what keeps this board free of a
    // moderation surface. Collisions are resolved where they are visible.
    const names = disambiguate(
      shown.map((r) => (r.is_oracle ? ORACLE_DESIGNATION : designation(r.userId!))),
    );
    const boardRows = shown.map((r, i) => ({
      name: names[i]!, points: r.points, rank: r.rank, is_you: r.is_you, is_oracle: r.is_oracle,
    }));

    return c.json({
      date,
      metric: "points",
      field_size: field.length,
      your_points: yourPoints,
      // Ties share the better rank: one plus the number of strictly better days.
      your_rank: yourPoints === null ? null : 1 + field.filter((p) => p > yourPoints).length,
      best_points: sorted[0]!,
      median_points: median,
      rows: boardRows,
    });
  });
