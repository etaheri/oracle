import { ReadingHeader } from "../../ui/ReadingHeader";
import { RevealSummary } from "../../ui/RevealSummary";
import { calculateDuel, duelLine, MILESTONE_COPY, type MilestoneId, type Reveal } from "@oracle/core";
import { getSeenMilestones, markMilestoneSeen } from "../../api/flags";
import { useMeLedger } from "../../api/hooks";
import { QuietLink } from "../../ui/Button";
import { ResolutionEvidence } from "../../ui/ResolutionEvidence";
import { useCallback, useEffect, useRef, useState } from "react";
import { View, ScrollView, StyleSheet, RefreshControl, useWindowDimensions } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, Easing, Keyframe, useReducedMotion } from "react-native-reanimated";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Canvas, Fill, LinearGradient, useCanvasRef, vec } from "@shopify/react-native-skia";
import { Screen, useScreenInset } from "../../ui/Screen";
import { Serif, Mono, Ritual, Eyebrow, role } from "../../ui/Text";
import { GoldButton } from "../../ui/Button";
import { GoldFrame } from "../../ui/GoldFrame";
import { TopBar } from "../../ui/TopBar";
import { AsciiDust } from "../../ui/TerminalPatina";
import { DecodeLine } from "../../ui/DecodeText";
import { ShareCardCanvas, shareCard, shareSnapshot, type ShareCardData } from "../../ui/ShareCard";
import { numeral } from "../../ui/CardChrome";
import { RollingPoints, ROLL_MS } from "../../ui/RollingPoints";
import type { QuestionResult } from "../../game/sharePattern";
import { payoff, oracleCallRight, dayCallCounts, CONSTANTS, provenanceLine } from "@oracle/core";
import { useReveal, useRoundBoard, useAllTimeBoard } from "../../api/hooks";
import { markRevealSeen } from "../../api/flags";
import { rowState, rowMark, rowRight, receiptLine, callLine, movementLine, crowdReadable, ledgerLines, pendingLine, lapsedLine, readingLine, pointsWithheld, weightLine, TOO_FEW_LINE } from "../../game/revealRows";
import { scaledLines, scaledRow } from "../../game/typeScaling";
import { isFortuneRound, stakedRound, fortuneHeadline, stakeReceipt, oracleTake, lineContext, fortuneRowRight, houseNightLine, moneyMark, bustLines, doubleObservation } from "../../game/revealFortune";
import { shareBigOneLine, fortuneShareMessage } from "../../game/shareLines";
import { boardLines, boardSupportingLines, boardRowLines, allTimeLines, allTimeRowLines, oracleDayLine, BOARD_MAX_LINES, ALL_TIME_TITLE } from "../../game/dailyBoard";
import { rivalryMoment } from "../../game/rivalryMoment";
import { capture } from "../../analytics/analytics";
import { colors, space, displayScale, ROW_H } from "../../theme";
import { councilFor, splitRows, evidenceFor, SPLIT_ROW_H, type SplitRow } from "../../game/council";
import { CouncilReading } from "../../ui/CouncilReading";

const easeOut = Easing.out(Easing.poly(4));
const ROW_DELAY = 0;
const ROW_STAGGER = 0;
const POINTS_DELAY = 0;
const BIG_ONE_DELAY = 0;

// The fold: how tall the fade at the bottom of the reveal is. Deep enough to
// read as the page dissolving rather than as a band lying on top of it — this
// screen is the one people screenshot, and it spends most of its height under
// the Big One's gold frame, where a hard edge reads as a rendering seam.
const FOLD_H = 32;

// The day-points headline's reserved height: the 54pt Ritual number's own
// line box plus the gap and the machine-voice label under it. Both states of
// the slot — the score, and the withheld count while the ledger is still
// being read — sit inside it, so the transition is an arrival rather than a
// shove. The conditional FIRST HOUR line is allowed to grow it: that one is
// the day's own news, the way the plaque's claim row is.
const POINTS_SLOT_H = 84;

// The board's own reserved height: BOARD_MAX_LINES of machine voice at a 15pt
// line box, plus the gap between them. The board arrives on a SECOND query,
// later than the reveal, and directly under the day's number — unreserved, the
// whole page would shove down at the exact moment the ceremony lands.
const BOARD_LINE_H = 15;
// The row list can add up to CONSTANTS.BOARD_ROWS_MAX lines under the
// summary line BOARD_MAX_LINES already reserves for -- both must fit inside
// the same arrival, or the row list shoves the page exactly as the summary
// line used to. The container's own `gap: space(1)` sits BETWEEN every child,
// so the reservation must cover the lines' boxes AND the (lines - 1) gaps
// between them, not just one trailing unit of slack -- that undercounts from
// 9 children on and is short by a full gap's width at the 10-child max.
const BOARD_LINES_MAX = BOARD_MAX_LINES + CONSTANTS.BOARD_ROWS_MAX;
const BOARD_SLOT_H = BOARD_LINES_MAX * BOARD_LINE_H + (BOARD_LINES_MAX - 1) * space(1);


// One golden surge through the Big One frame when the player beat the tide.
const TideFlash = new Keyframe({
  0: { opacity: 0 },
  40: { opacity: 1 },
  100: { opacity: 0, easing: Easing.out(Easing.poly(4)) },
}).duration(900).delay(BIG_ONE_DELAY + 500);

// The Council split (design 2026-09-11 §15.2): one row per member under the
// line, coloured by the side it was on, then the house line. Reserves its
// height only when it has rows, so a version 2 reveal, an unstaked round and
// a pending reveal lose nothing.
function CouncilSplit({ d, questionId, linePYes, fontScale, align = "left" }: { d: Reveal; questionId: string; linePYes: number | null; fontScale: number; align?: "left" | "center" }) {
  const entries = councilFor(d, questionId);
  const rows = splitRows(entries, linePYes);
  if (rows.length === 0) return null;
  const pack = evidenceFor(d, questionId);
  const tone = (t: SplitRow["tone"]) => (t === "win" ? colors.goldText : t === "loss" ? colors.vermilion : colors.mutedInk);
  return (
    <View style={{ minHeight: scaledRow(SPLIT_ROW_H, fontScale) * rows.length + 44 * entries.filter((e) => e.member !== "market").length }} accessibilityLabel={`The Council: ${rows.map((r) => r.label.toLowerCase()).join(", ")}`}>
      {rows.map((r) => {
        const entry = entries.find((e) => e.member === r.member);
        return (
          <View key={r.member}>
            <Mono {...role.meta} color={tone(r.tone)} style={[role.meta.style, { textAlign: align }]}>{r.label}</Mono>
            {entry && entry.member !== "market" && <CouncilReading entry={entry} pack={pack} questionId={questionId} />}
          </View>
        );
      })}
    </View>
  );
}

export default function RevealScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const reveal = useReveal(date ?? null);
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const inset = useScreenInset();
  const [headerHeight, setHeaderHeight] = useState(inset.top + 44);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const canvasRef = useCanvasRef();
  const [details, setDetails] = useState(false);
  // The board reads two ways at version 3: this round's field, and the
  // all-time table of fortunes. One slot, one mode switch under it.
  const [boardMode, setBoardMode] = useState<"daily" | "all-time">("daily");
  // The standing lines are not the round's news at version 3 -- they sit
  // behind SHOW DETAILS so the delta stands alone under the headline.
  const [standing, setStanding] = useState(false);
  const [milestone, setMilestone] = useState<MilestoneId | null>(null);
  const milestonePicked = useRef(false);
  const history = useMeLedger();
  useEffect(() => {
    let active = true;
    if (milestonePicked.current || !history.data?.milestones.length || !reveal.data || "pending" in reveal.data || !reveal.data.ledger.settled) return;
    void getSeenMilestones().then(seen => {
      if (!active || milestonePicked.current) return;
      milestonePicked.current = true;
      const earned = history.data!.milestones.find(id => !seen.includes(id));
      if (earned) { setMilestone(earned); void markMilestoneSeen(earned); }
    });
    return () => { active = false; };
  }, [history.data, reveal.data]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["reveal", date] }),
      qc.invalidateQueries({ queryKey: ["board", date] }),
    ]);
    setRefreshing(false);
  }, [qc, date]);
  // The Big One and the share button live below the fold on smaller devices —
  // refs for the raw measurements so onLayout/onContentSizeChange never
  // trigger a render loop, state only for the boolean that gates the fade.
  const [overflows, setOverflows] = useState(false);
  // ...and the fade retires the moment the reader reaches the end of it: a
  // marker for content below is a lie once there is no content below.
  const [atBottom, setAtBottom] = useState(false);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const boardScrollRequested = useRef(false);
  const recomputeOverflow = () => setOverflows(contentH.current > viewportH.current + 1);
  const loaded = !!reveal.data && !("pending" in reveal.data);
  // reveal.data's reference changes on every refetch (staleTime 0 + AppState
  // focus refetches), so the resolved-outcomes effect below can re-run for
  // the same date many times — the guard fires the capture once per date.
  const viewedFor = useRef<string | null>(null);
  // The bust is counted on its own clock. The ceremony effect below fires the
  // instant the reveal lands and never runs again for the date, but the best
  // rides a SECOND query -- so counting the bust inside that guard sent
  // `best: null` on every cold open. Its own ref and its own effect wait for
  // the record, then count the date exactly once.
  const bustCapturedFor = useRef<string | null>(null);
  // The board exists only once every row carries an outcome — the endpoint
  // 409s before that, for the same reason the day's number is withheld.
  const dayRead = !!reveal.data && !("pending" in reveal.data) && reveal.data.questions.every((q) => q.outcome !== null);
  const board = useRoundBoard(date ?? null, dayRead);
  const allTime = useAllTimeBoard(dayRead && boardMode === "all-time");

  // The day-points landing is the ceremony's beat — the number finishes its
  // roll, THEN the haptic lands. A contrarian big-one win gets a double
  // heavy strike at the Big One's entrance.
  useEffect(() => {
    if (!loaded) return;
    const d2 = reveal.data;
    if (!d2 || "pending" in d2) return;
    // Some rows can still be outcome: null right at noon while resolution is
    // in flight. Neither the ceremony nor the seen-mark fires on a still-
    // pending ledger — the flag must survive so the gold CTA and the real
    // ceremony still happen once every row has resolved.
    if (d2.questions.some((q) => q.outcome === null)) return;
    if (d2.rules_version >= 2 && viewedFor.current === d2.date) return;
    if (viewedFor.current !== d2.date) {
      viewedFor.current = d2.date;
      capture("reveal_viewed", { date: d2.date, delta: d2.delta });
      capture("reveal_summary_viewed", { date: d2.date, rules_version: d2.rules_version });
    }
    if (d2.rules_version >= 2) {
      void markRevealSeen(d2.date);
      const result = calculateDuel(d2.questions.map(q => ({ ...q, is_big_one: q.slot === 5 })), d2.rules_version);
      if (result.status === "complete" && result.winner === "you") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    const spectator = d2.questions.every((q) => q.my === null);
    const timers: ReturnType<typeof setTimeout>[] = [];
    // A spectator reveal has nothing to celebrate — mark it seen right away
    // instead of waiting on a ceremony that never plays.
    if (spectator) {
      void markRevealSeen(d2.date);
    } else {
      const big2 = d2.questions.find((q) => q.slot === 5);
      // Version 1 only: every later version returned above. Which is what
      // keeps the bounty's double strike off a version 3 reveal, where the
      // bounty itself no longer exists (design D8).
      const tide = !!big2?.my && (big2.my.points ?? 0) > payoff(big2.my.confidence, true).win;
      timers.push(setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), reducedMotion ? 0 : POINTS_DELAY + ROLL_MS));
      timers.push(setTimeout(() => markRevealSeen(d2.date), reducedMotion ? 0 : POINTS_DELAY + ROLL_MS));
      if (tide && !reducedMotion) {
        timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), BIG_ONE_DELAY + 650));
        timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), BIG_ONE_DELAY + 800));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [loaded, reducedMotion, reveal.data]);

  // The bust, counted once per date and never without the best beside it.
  useEffect(() => {
    const d2 = reveal.data;
    if (!d2 || "pending" in d2 || d2.bust_fortune === null) return;
    if (!history.data) return;
    if (bustCapturedFor.current === d2.date) return;
    bustCapturedFor.current = d2.date;
    capture("bust_viewed", { best: history.data.best_fortune });
  }, [reveal.data, history.data]);

  if (reveal.isLoading) return (
    <Screen>
      <TopBar label="OUTSEEN" />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <DecodeLine {...role.eyebrow} text="CONSULTING THE VOID…" cursor color={colors.goldText} style={{ textAlign: "center" }}/>
      </View>
    </Screen>
  );
  if (reveal.isError) return (
    <Screen><TopBar label="OUTSEEN" /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <DecodeLine {...role.line} text="THE ORB IS BEYOND REACH. IT WILL RETURN." color={colors.mutedInk} style={{ textAlign: "center" }}/>
    </View></Screen>
  );
  if (!reveal.data || "pending" in reveal.data) {
    return <Screen><TopBar label="OUTSEEN" /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <View style={{ alignItems: "center" }}><AsciiDust /></View>
      <Eyebrow>{`Day ${date ?? ""}`}</Eyebrow>
      <Serif size={displayScale.lead} style={{ textAlign: "center" }}>Not yet settled.</Serif>
      <DecodeLine {...role.line} text={pendingLine(date ?? "", new Date().toISOString().slice(0, 10))} cursor color={colors.mutedInk} style={{ textAlign: "center" }}/>
    </View></Screen>;
  }

  const d = reveal.data;
  const big = d.questions.find((q) => q.slot === 5);
  const bigState = big ? rowState(big) : null;
  // Version 3 reads the whole page in money: the headline is a delta, the
  // rows are stakes, and the duel -- which had no money in it -- is gone.
  // An unstaked version 3 round (no line committed, design §5.5) and a version
  // 3 spectator have no money to read, so they fall through to the points
  // rendering below rather than to a blank money headline.
  const fortuneRound = isFortuneRound(d) && stakedRound(d);
  // There is no bounty at version 3 (design D8): the odds already paid for
  // standing against the field. Gated here rather than at each consumer so the
  // gold surge over the frame cannot outlive the line it celebrates.
  const contrarianWin = !fortuneRound && !!big?.my && (big.my.points ?? 0) > payoff(big.my.confidence, true).win;
  const anyPending = d.questions.some((q) => rowState(q) === "pending");
  const allSpectator = d.questions.every((q) => q.my === null);
  const results = [...d.questions].sort((a, b) => a.slot - b.slot).map((q): QuestionResult => {
    const st = rowState(q);
    return st === "win" ? "win" : st === "loss" ? "loss" : st === "void" ? "void" : "none"; // pending, spectator → none
  });
  // The machine's own count against the day -- null (and so omitted below)
  // until it actually forecast a scored question. Computed once here rather
  // than at each of its two call sites (the closing line, the night card).
  const duel = calculateDuel(d.questions.map(q => ({ ...q, is_big_one: q.slot === 5 })), d.rules_version);
  const rivalry = rivalryMoment(d.questions.map(q => ({ ...q, is_big_one: q.slot === 5 })), duel);
  const oracleLine = d.rules_version >= 2 ? duelLine(duel) : oracleDayLine(d.questions);
  const oracleCounts = oracleLine !== null ? dayCallCounts(d.questions) : null;
  const cardData: ShareCardData = {
    date: d.date,
    dayPoints: d.day_points,
    bigOneText: big?.text ?? null,
    bigOneCrowdPct: big?.crowd_yes_pct ?? null,
    bigOneMarketPct: big?.market_prob != null ? Math.round(big.market_prob * 100) : null,
    results,
    ...(d.rules_version >= 2 && duel.status === "complete" ? { duelScores: { you: duel.youPoints, oracle: duel.oraclePoints } } : {}),
    ...(d.rules_version >= 2 ? { duelText: duelLine(duel) ?? undefined } : oracleCounts ? { oracleDayCounts: oracleCounts } : null),
    // The night card in money (design §8.3). Set ONLY on a fortune round --
    // the canvas branches on `fortuneDelta !== undefined`, so a version 1 or 2
    // card must not carry the key at all.
    ...(fortuneRound
      ? {
          fortuneDelta: d.delta ?? undefined,
          fortuneAfter: d.fortune_after ?? undefined,
          bigOneLine: shareBigOneLine({
            line: big?.line_p_yes ?? null,
            answer: big?.my?.answer ?? null,
            stake: big?.my?.stake ?? null,
            delta: big?.my?.delta ?? null,
          }),
        }
      : {}),
  };
  // The one line about the double, read once for the block below.
  const doubleRead = doubleObservation(d.questions);
  // Your standing, which is NOT this round's news. Rendered inline under the
  // day's number at versions 1 and 2; folded behind SHOW DETAILS at version 3.
  const standingLines = (
    <>
      {ledgerLines(d.ledger, d.rules_version).map((line, i) => (
        <Mono key={i} size={10} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }}>{line}</Mono>
      ))}
      {/* What the night cost, in candidates. It belongs with the standing
          lines rather than the day's headline: it is a fact about the
          machine, not about this player's day. Null — and therefore absent —
          for a bank drop and for every round authored before migration 0007. */}
      {provenanceLine(d.candidates_written, d.candidates_rejected) && (
        <Mono size={10} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }}>
          {provenanceLine(d.candidates_written, d.candidates_rejected)}
        </Mono>
      )}
    </>
  );

  async function onShare() {
    setSharing(true);
    setShareError(null);
    try {
      await (fortuneRound
        ? shareSnapshot(canvasRef, `oracle-${d.date}.png`, fortuneShareMessage({ date: d.date, delta: d.delta!, fortuneAfter: d.fortune_after!, results }))
        : shareCard(canvasRef, cardData));
    } catch {
      // Every other failure in this app has a written line; this one used to
      // be swallowed whole, so a failed share simply did nothing.
      setShareError("COULD NOT SHARE YOUR RESULT. TRY AGAIN.");
    } finally {
      setSharing(false);
    }
  }

  return (
    // Bleed, and pay the margin on the content. Inside Screen's padded box the
    // scroller ended a gutter above the glass, so the page finished on a band
    // of dead ground over the home indicator — a screen cut off rather than a
    // screen running out — and the fold fade marked that false edge instead of
    // the real one. Now the ledger travels the full height and comes to rest
    // clear of the indicator on its own.
    <Screen bleed>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          gap: space(4),
          paddingTop: headerHeight + space(4),
          paddingLeft: inset.left,
          paddingRight: inset.right,
          paddingBottom: inset.bottom + space(6),
        }}
        // No indicator. The scroller now bleeds to the glass, so iOS would
        // draw the bar at the true right edge rather than floating a gutter
        // in — but the app's other scrollers (the rites, the crowd finale,
        // the ledger) all hide theirs, and this screen has the fold fade
        // below to say there is more. A grey system rail over the museum
        // ground was the least in-voice thing on the page.
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: headerHeight }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedInk} colors={[colors.agedGold]} />}
        onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; recomputeOverflow(); }}
        onContentSizeChange={(_w, h) => { contentH.current = h; recomputeOverflow(); }}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          setHeaderScrolled(contentOffset.y > 2);
          // Setting the same boolean back is a React bail-out, so this is free
          // on every frame that does not actually cross the end.
          setAtBottom(contentOffset.y + layoutMeasurement.height >= contentSize.height - 1);
        }}
      >
        <Eyebrow>
          {anyPending
            ? `Day ${d.date} · still settling`
            : allSpectator
              // The lapsed line directly below says the round was settled
              // without you in full, and with more feeling. Saying it in the
              // eyebrow too printed the same sentence twice, stacked.
              ? `Day ${d.date}`
              : `Day ${d.date} · settled`}
        </Eyebrow>
        {/* "Outseen · You vs the Oracle" used to print here as a second
            eyebrow. It is the app's own name and premise, identical on every
            reveal ever rendered, stacked under the line that says which day
            this is — a banner inside the building it names. */}
        {/* The duel headline and the rivalry moment are both scored in
            points, and version 3 has no points to score them with — the
            fortune headline below IS the summary there. */}
        {!fortuneRound && <RevealSummary data={d} milestone={milestone ? MILESTONE_COPY[milestone] : null} />}
        {!fortuneRound && rivalry && (
          <View style={{ alignItems: "center", gap: space(1) }}>
            <Eyebrow>Largest points gap</Eyebrow>
            <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "center" }]}>{rivalry.line}</Mono>
          </View>
        )}
        {allSpectator && !anyPending && (
          <DecodeLine text={lapsedLine(d.date)} {...role.meta} color={colors.mutedInk} />
        )}
        <Animated.View
          entering={FadeIn.delay(POINTS_DELAY).duration(500).easing(easeOut)}
          // The headline slot is one height in both states. It holds a 54pt
          // Ritual numeral over its label when the day is read, and the
          // withheld count over its own label while it is not — and a player
          // pulling to refresh mid-resolution watches this exact block swap.
          // Reserved, the number simply arrives; unreserved, the whole page
          // under it jumps ~35pt at the moment of the ceremony.
          style={{ alignItems: "center", justifyContent: "center", gap: space(1), minHeight: POINTS_SLOT_H }}
        >
          {/* The day's score is withheld until the day is actually read.
              day_points sums `points ?? 0`, so mid-resolution — which retries
              hourly, and home sends the player here the moment ONE row
              resolves — this printed a real, low number that silently climbed
              on the next refresh. In an app whose liturgy is "NOTHING IS
              REVISED", a provisional score is the wrong trade: the slot says
              how much has been read instead, and the number arrives once. */}
          {/* Version 3's headline is the round's delta and the fortune it
              leaves behind (design §8.3). Both figures are withheld by the
              route until every card is decided, so the slot holds the read
              count in the meantime — the same promise the day's number keeps
              below, made in money. */}
          {!allSpectator && (fortuneRound ? (() => {
            const h = fortuneHeadline(d);
            if (h.kind === "none") return null;
            if (h.kind === "withheld") return (
              <>
                <Ritual bold size={displayScale.epithet} color={colors.mutedInk} letterSpacing={3} style={{ marginRight: -3, textAlign: "center" }}>{h.read}</Ritual>
                <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>FORTUNE WITHHELD</Mono>
              </>
            );
            return (
              <>
                <Ritual bold size={displayScale.points} color={d.delta! >= 0 ? colors.goldText : colors.vermilion} letterSpacing={2} style={{ marginRight: -2 }}>{h.delta}</Ritual>
                <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>{h.fortune}</Mono>
                {houseNightLine(d.house_delta) && <Mono {...role.caption} color={colors.mutedInk}>{houseNightLine(d.house_delta)}</Mono>}
              </>
            );
          })() : (pointsWithheld(d) ? (
            <>
              <Ritual bold size={displayScale.epithet} color={colors.mutedInk} letterSpacing={3} style={{ marginRight: -3, textAlign: "center" }}>{readingLine(d.questions)}</Ritual>
              <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>DAY POINTS WITHHELD</Mono>
            </>
          ) : (
            <>
              <RollingPoints value={d.day_points} delayMs={POINTS_DELAY} />
              <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>DAY POINTS</Mono>
              {d.rules_version >= 2 && d.bonus_points !== 0 && <Mono {...role.caption} color={colors.mutedInk}>PLAYERS BONUS {d.bonus_points} · EXCLUDED FROM DUEL AND RANK</Mono>}
              {/* Both weights on one line. The first hour is not gated on a
                  winning day any more — the bonus is symmetric (design
                  2026-09-03 §2), so gating it on day_points > 0 hid it on
                  exactly the days it cost the player something, which is the
                  one direction it must never be silent in. */}
              {weightLine(d) && (
                <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{weightLine(d)}</Mono>
              )}
            </>
          )))}
          {/* Your standing, which is NOT this day's news — the count and the
              score are true before the page loads and stay true after it. They
              were gold, which put four gold lines under one number and made the
              block read as four headlines instead of one. Muted and set apart,
              they subordinate to the day without leaving it. Version 3 folds
              them behind SHOW DETAILS above the board instead. */}
          {/* A milestone is marked seen the instant it is picked, so it has to
              be SHOWN the instant it is picked. At versions 1 and 2
              RevealSummary prints it; version 3 has no summary, and the
              details fold below can stay closed forever — so it stands here,
              under the round's own figure. */}
          {fortuneRound && milestone && (
            <Mono {...role.line} color={colors.mutedInk} style={[role.line.style, { marginTop: space(2) }]}>{MILESTONE_COPY[milestone]}</Mono>
          )}
          {/* The bust, once, under the round's own figure: what the house took,
              the best the run reached, and when the next fortune opens. It is
              the run's ending, so it is allowed to grow this block the way the
              milestone is — it is this page's biggest piece of news. */}
          {fortuneRound && (() => {
            const bust = bustLines(d, history.data?.best_fortune ?? null);
            if (!bust) return null;
            return (
              <View style={{ alignItems: "center", gap: space(1), marginTop: space(3) }}>
                <Ritual bold size={displayScale.epithet} color={colors.vermilion} letterSpacing={3} style={{ marginRight: -3, textAlign: "center" }}>{bust.took}</Ritual>
                {bust.best && <Mono size={10} color={colors.goldText} letterSpacing={5} style={{ marginRight: -5 }}>{bust.best}</Mono>}
                <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "center" }]}>{bust.read}</Mono>
              </View>
            );
          })()}
          {fortuneRound && doubleRead && (
            <Mono {...role.line} color={doubleRead === "YOUR DOUBLE PAID" ? colors.goldText : colors.mutedInk} style={[role.line.style, { marginTop: space(2) }]}>{doubleRead}</Mono>
          )}
          {!fortuneRound && (
            <View style={{ alignItems: "center", gap: space(1), marginTop: space(2) }}>
              {standingLines}
            </View>
          )}
        </Animated.View>
        {/* The day's four ordinary calls, in the card's vocabulary rather
            than a settings list (refinement spec §2): the slot numeral is
            the anchor, the prophecy keeps the temple voice it was asked in,
            and the receipt drops to machine voice underneath it. One rule
            closes the group instead of four rules boxing every row. */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
          {d.questions.filter((q) => q.slot !== 5).map((q, i) => {
            const st = rowState(q);
            // At version 3 a row's fortune is its own verdict: the sign of the
            // delta, not the win/loss the points ladder used to hand out.
            const money = fortuneRound;
            const color = money
              ? (q.my?.delta == null ? colors.mutedInk : q.my.delta > 0 ? colors.goldText : q.my.delta < 0 ? colors.vermilion : colors.mutedInk)
              : st === "win" ? colors.goldText : st === "loss" ? colors.vermilion : colors.mutedInk;
            const receipt = receiptLine(q);
            const call = money ? stakeReceipt(q) : callLine(q);
            const take = money ? oracleTake(q) : null;
            const context = money ? lineContext(q) : null;
            const right = money ? fortuneRowRight(q) : rowRight(q);
            const movement = movementLine(q);
            return (
              <Animated.View
                key={q.id}
                entering={FadeInDown.delay(ROW_DELAY + i * ROW_STAGGER).duration(400).easing(easeOut)}
                style={{ flexDirection: "row", gap: space(3), paddingVertical: space(3), alignItems: "flex-start" }}
              >
                <Ritual size={displayScale.slot} color={color} letterSpacing={1} style={{ width: 22, textAlign: "center" }}>
                  {numeral(q.slot)}
                </Ritual>
                <View style={{ flex: 1, gap: space(1) }}>
                  <Serif size={displayScale.inline} color={colors.ink} numberOfLines={scaledLines(3, fontScale)} style={{ lineHeight: 21 }}>{q.text}</Serif>
                  {/* What you said, and what the crowd said — the Big One's
                      block has always read both back; the four ordinary calls
                      showed only their points, so a day later the ledger could
                      not tell you what you had answered. */}
                  {call ? (
                    <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>{call}</Mono>
                  ) : null}
                  {/* Who took whom on this card (design §8.3). Gold only when
                      it was the player — the machine's wins stay in the
                      register every other muted line uses. */}
                  {take ? (
                    <Mono {...role.caption} color={take.startsWith("YOU") ? colors.goldText : colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>{take}</Mono>
                  ) : null}
                  {context ? (
                    <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>{context}</Mono>
                  ) : null}
                  {money && <CouncilSplit d={d} questionId={q.id} linePYes={q.line_p_yes} fontScale={fontScale} />}
                  {/* How the tide moved after this player sealed (design
                      2026-09-09 §4.1) — no reserved space: rows are already
                      variable height, and most days say nothing here. */}
                  {movement ? (
                    <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>{movement}</Mono>
                  ) : null}
                  <ResolutionEvidence question={q} />
                  {receipt ? (
                    <Mono {...role.caption} color={colors.mutedInk} numberOfLines={2} style={[role.caption.style, { textAlign: "left" }]}>{receipt}</Mono>
                  ) : null}
                </View>
                {/* The mark rides with the value: outcome must never be
                    carried by colour alone (brief §11). */}
                <Mono size={12} color={color} letterSpacing={1}>{`${money ? moneyMark(q) : rowMark(st)} ${right}`}</Mono>
              </Animated.View>
            );
          })}
        </View>
        {big && (
          <Animated.View entering={FadeInDown.delay(BIG_ONE_DELAY).duration(500).easing(easeOut)}>
          <GoldFrame style={{ backgroundColor: colors.frescoWhite }}>
            {contrarianWin && !reducedMotion && (
              <Animated.View pointerEvents="none" entering={TideFlash} style={[StyleSheet.absoluteFill, { backgroundColor: colors.goldWash }]} />
            )}
            {/* This is the card the player pulled, read back to them, so it is
                set as that card was: fresco ground, the slot numeral carved at
                the head, the category bracketed beneath it. It used to open
                with a 110pt strip of cropped photograph whose cyan halo and
                saturated sleeve belonged to no other surface in the app — a
                banner, in a product that otherwise never uses one. The gold
                frame already says which question this is; it does not need a
                picture to say it twice. */}
            <View style={{ padding: space(5), paddingBottom: space(3), gap: space(3) }}>
              <View style={{ alignItems: "center", gap: space(2) }}>
                <Ritual bold size={displayScale.stamp} color={colors.goldText} letterSpacing={5} style={{ marginRight: -5 }}>{numeral(big.slot)}</Ritual>
                <Ritual bold size={displayScale.slot} letterSpacing={4}>[ ✶ THE BIG ONE ]</Ritual>
              </View>
              <Serif size={displayScale.inline}>{big.text}</Serif>
              <ResolutionEvidence question={big} />
              {bigState === "pending" && (
                <Mono {...role.supporting} color={colors.mutedInk}>{receiptLine(big)}</Mono>
              )}
              {bigState === "void" && (
                <Mono {...role.supporting} color={colors.mutedInk}>{receiptLine(big)}</Mono>
              )}
              {/* Version 3's money lines do not depend on the field having
                  left a percentage behind -- a stake, its payout and the line
                  it was priced against are true on their own. The PLAYERS
                  line inside is still gated on `crowdReadable`. */}
              {bigState !== "pending" && bigState !== "void" && (fortuneRound || big.crowd_yes_pct !== null) && (
                <View style={{ gap: space(1) }}>
                  {big.my && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      {fortuneRound ? (
                        <Mono {...role.supporting} color={colors.ink}>{stakeReceipt(big)}</Mono>
                      ) : (
                        <Mono {...role.supporting} color={colors.ink}>YOU: {big.my.answer ? "YES" : "NO"} @ {big.my.confidence}%</Mono>
                      )}
                      {fortuneRound ? (
                        <Mono {...role.supporting} color={big.my.delta == null ? colors.mutedInk : big.my.delta > 0 ? colors.goldText : big.my.delta < 0 ? colors.vermilion : colors.mutedInk}>
                          {fortuneRowRight(big)}
                        </Mono>
                      ) : (
                        <Mono {...role.supporting} color={(big.my.points ?? 0) >= 0 ? colors.goldText : colors.vermilion}>
                          {(big.my.points ?? 0) > 0 ? `+${big.my.points}` : String(big.my.points ?? "—")}
                        </Mono>
                      )}
                    </View>
                  )}
                  {/* Same floor as the round footer and the finale: over a
                      handful of players the percentage is mostly the reader,
                      and this frame is the one people screenshot. */}
                  <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>{crowdReadable(big) ? `PLAYERS SAID ${big.crowd_yes_pct}% YES` : TOO_FEW_LINE}</Mono>
                  {big.market_prob != null && (
                    <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>THE MARKET SAID {Math.round(big.market_prob * 100)}% YES</Mono>
                  )}
                  {/* Version 3 quotes the LINE the stake was priced against,
                      not the forecast behind it — the line is the number the
                      player actually played, and the only one they can check
                      the payout against. */}
                  {fortuneRound ? (
                    big.line_p_yes != null && big.outcome !== "void" && big.outcome !== null && (
                      <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>
                        THE ORACLE'S LINE {Math.round(big.line_p_yes * 100)}% YES{" "}
                        {oracleCallRight(big.line_p_yes, big.outcome) === null
                          ? ""
                          : oracleCallRight(big.line_p_yes, big.outcome)
                            ? "✓"
                            : "✗"}
                      </Mono>
                    )
                  ) : (
                    big.oracle_p_yes != null && big.outcome !== "void" && big.outcome !== null && (
                      <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>
                        THE ORACLE FORESAW {Math.round(big.oracle_p_yes * 100)}% YES{" "}
                        {oracleCallRight(big.oracle_p_yes, big.outcome) === null
                          ? ""
                          : oracleCallRight(big.oracle_p_yes, big.outcome)
                            ? "✓"
                            : "✗"}
                      </Mono>
                    )
                  )}
                  {fortuneRound && <CouncilSplit d={d} questionId={big.id} linePYes={big.line_p_yes} fontScale={fontScale} />}
                  {fortuneRound && oracleTake(big) && (
                    <Mono {...role.caption} color={(big.my?.delta ?? 0) > 0 ? colors.goldText : colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>{oracleTake(big)}</Mono>
                  )}
                  <Mono {...role.caption} color={colors.mutedInk} numberOfLines={2} style={[role.caption.style, { textAlign: "left" }]}>{receiptLine(big)}</Mono>
                  {/* `contrarianWin` is already false at version 3 -- there is
                      no bounty there (design D8). */}
                  {contrarianWin && (
                    <Animated.View entering={FadeIn.delay(BIG_ONE_DELAY + 600).duration(400).easing(easeOut)} style={{ flexDirection: "row", alignItems: "baseline", gap: space(2), justifyContent: "center" }}>
                      <Ritual bold size={displayScale.slot} letterSpacing={3}>AGAINST THE TIDE</Ritual>
                      <Ritual bold size={displayScale.lead} color={colors.agedGold} letterSpacing={1}>+40</Ritual>
                    </Animated.View>
                  )}
                </View>
              )}
            </View>
          </GoldFrame>
          </Animated.View>
        )}
        {/* The machine's own count against the day, once it forecast enough
            of it to have one (design's Oracle-record beat). Gold only when
            the reader actually outdid it today -- a tie or a loss stays in
            the register the standing lines already use. */}
        {d.rules_version < 2 && oracleLine !== null && (
          <Animated.View entering={FadeInDown.delay(BIG_ONE_DELAY + 260).duration(400).easing(easeOut)}>
            <Mono {...role.line}
              color={oracleCounts!.you > oracleCounts!.oracle ? colors.goldText : colors.mutedInk}
            >
              {oracleLine}
            </Mono>
          </Animated.View>
        )}
        {/* Version 3's standing lines, folded away. The delta is the round's
            one piece of news; the streak and the night's provenance are both
            true before the page loads and stay true after it, so they open
            only when asked for. Two rows, not three: the forecast rating left
            this fold with the rest of the calibration (spec H8). */}
        {fortuneRound && !allSpectator && (
          <View style={{ alignItems: "center", gap: space(1) }}>
            <View style={{ minHeight: standing ? scaledRow(ROW_H.meta, fontScale) * 2 : 0, alignItems: "center", justifyContent: "center", gap: space(1) }}>
              {standing && standingLines}
            </View>
            <QuietLink title={standing ? "HIDE DETAILS" : "SHOW DETAILS"} onPress={() => setStanding((open) => !open)} />
          </View>
        )}
        {/* Where the day stood.
            This block used to be printed twice — once above the fold and once
            again inside the collapsed section — and the link that opened the
            second copy was labelled VIEW DAILY BOARD while actually hiding
            the entire ledger behind it: the day's points, all five call rows
            and the Big One. The rank is part of the reveal and reads with it;
            the link now opens only the thing it names, the field itself. */}
        {!allSpectator && (
          <View
            onLayout={(event) => {
              if (!boardScrollRequested.current) return;
              boardScrollRequested.current = false;
              scrollRef.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - headerHeight - space(2)), animated: !reducedMotion });
            }}
            style={{ alignItems: "center", gap: space(1) }}
          >
            <Eyebrow>{boardMode === "daily" ? "Daily board" : ALL_TIME_TITLE}</Eyebrow>
            {/* The board rides a SECOND query, later than the reveal. Collapsed
                it reserves its one summary line; expanded it reserves the whole
                field, so neither arrival shoves the share button below it. */}
            <View style={{ minHeight: details ? BOARD_SLOT_H : BOARD_MAX_LINES * BOARD_LINE_H, alignItems: "center", justifyContent: "center", gap: space(1) }}>
              {boardMode === "daily" ? <>
                {boardLines(board.data ?? undefined, d.rules_version).map((line, i) => (
                  <Mono key={`board-${i}`} {...role.meta} color={board.data?.your_rank != null ? colors.goldText : colors.mutedInk} style={[role.meta.style, { lineHeight: BOARD_LINE_H }]}>{line}</Mono>
                ))}
                {details && <>
                  {boardSupportingLines(board.data ?? undefined, d.rules_version).map((line, i) => (
                    <Mono key={`support-${i}`} {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "center", lineHeight: BOARD_LINE_H }]}>{line}</Mono>
                  ))}
                  {boardRowLines(board.data?.rows ?? [], board.data?.metric ?? "points").map((line, i) => (
                    <Mono key={`row-${i}`} {...role.meta} color={board.data!.rows[i]!.is_you ? colors.goldText : board.data!.rows[i]!.is_oracle ? colors.ink : colors.mutedInk} style={[role.meta.style, { lineHeight: BOARD_LINE_H }]}>{line}</Mono>
                  ))}
                </>}
              </> : <>
                {/* The all-time table (design §7): fortune, not points, and no
                    machine standing in it — the house is not a player. */}
                {allTimeLines(allTime.data).map((line, i) => (
                  <Mono key={`all-${i}`} {...role.meta} color={allTime.data?.your_rank != null ? colors.goldText : colors.mutedInk} style={[role.meta.style, { lineHeight: BOARD_LINE_H }]}>{line}</Mono>
                ))}
                {details && allTimeRowLines(allTime.data?.rows ?? []).map((line, i) => (
                  <Mono key={`all-row-${i}`} {...role.meta} color={allTime.data!.rows[i]!.is_you ? colors.goldText : colors.mutedInk} style={[role.meta.style, { lineHeight: BOARD_LINE_H }]}>{line}</Mono>
                ))}
              </>}
            </View>
            <QuietLink
              title={details ? "HIDE THE FIELD" : "SEE THE FIELD"}
              onPress={() => {
                if (details) setDetails(false);
                else { boardScrollRequested.current = true; setDetails(true); }
              }}
            />
            <QuietLink
              title={boardMode === "daily" ? "SEE THE ALL-TIME BOARD" : "SEE THE DAILY BOARD"}
              onPress={() => setBoardMode((mode) => (mode === "daily" ? "all-time" : "daily"))}
            />
          </View>
        )}
        {/* Version 3 shares the delta, so it waits on the same figure the
            headline waits on rather than on the day's weighed points. */}
        {(fortuneRound ? fortuneHeadline(d).kind === "settled" : !pointsWithheld(d) && results.some(r => r !== "none")) && <GoldButton title={sharing ? "PREPARING…" : "SHARE YOUR RESULT"} onPress={onShare} disabled={sharing} />}
        {shareError && <Mono {...role.meta} color={colors.vermilion} accessibilityRole="alert">{shareError}</Mono>}
        <QuietLink title="SHOW RULES" onPress={() => router.push({ pathname: "/rites", params: { all: "1", rules_version: String(d.rules_version) } })} />
      </ScrollView>
      <ReadingHeader inset={inset} scrolled={headerScrolled} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}><TopBar /></ReadingHeader>
      {overflows && !atBottom && (
        // The Big One and the share button live below the fold on smaller
        // devices, and nothing said so. It has to be an actual fade: this was
        // a flat 0.9-opacity band with a hard top edge, and over the Big One's
        // gilded frame that edge read as a rendering seam rather than as the
        // page continuing. Skia, the same way GoldFrame draws its leaf — Fill
        // takes the canvas, so the gradient needs no measurement, only its own
        // height.
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: FOLD_H }}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <LinearGradient start={vec(0, 0)} end={vec(0, FOLD_H)} colors={[colors.museumWhiteClear, colors.museumWhite]} />
            </Fill>
          </Canvas>
        </View>
      )}
      <ShareCardCanvas canvasRef={canvasRef} data={cardData} />
    </Screen>
  );
}
