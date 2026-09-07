import { RevealSummary } from "../../ui/RevealSummary";
import { calculateDuel, duelLine, MILESTONE_COPY, type MilestoneId } from "@oracle/core";
import { getSeenMilestones, markMilestoneSeen } from "../../api/flags";
import { useMeLedger } from "../../api/hooks";
import { QuietLink } from "../../ui/Button";
import { useCallback, useEffect, useRef, useState } from "react";
import { View, ScrollView, StyleSheet, RefreshControl, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, Easing, Keyframe, useReducedMotion } from "react-native-reanimated";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Canvas, Fill, LinearGradient, useCanvasRef, vec } from "@shopify/react-native-skia";
import { Screen, useScreenInset } from "../../ui/Screen";
import { Serif, Mono, Ritual, Eyebrow } from "../../ui/Text";
import { GoldButton } from "../../ui/Button";
import { GoldFrame } from "../../ui/GoldFrame";
import { TopBar } from "../../ui/TopBar";
import { AsciiDust } from "../../ui/TerminalPatina";
import { DecodeLine } from "../../ui/DecodeText";
import { ShareCardCanvas, shareCard, type ShareCardData } from "../../ui/ShareCard";
import { numeral } from "../../ui/CardChrome";
import { RollingPoints, ROLL_MS } from "../../ui/RollingPoints";
import type { QuestionResult } from "../../game/sharePattern";
import { payoff, oracleCallRight, dayCallCounts, CONSTANTS, provenanceLine } from "@oracle/core";
import { useReveal, useRoundBoard } from "../../api/hooks";
import { markRevealSeen } from "../../api/flags";
import { rowState, rowMark, rowRight, receiptLine, callLine, crowdReadable, ledgerLines, pendingLine, lapsedLine, readingLine, pointsWithheld, weightLine, TOO_FEW_LINE } from "../../game/revealRows";
import { boardLines, boardRowLines, oracleDayLine, BOARD_MAX_LINES } from "../../game/dailyBoard";
import { capture } from "../../analytics/analytics";
import { colors, space } from "../../theme";

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

export default function RevealScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const reveal = useReveal(date ?? null);
  const reducedMotion = useReducedMotion();
  const inset = useScreenInset();
  const canvasRef = useCanvasRef();
  const [details, setDetails] = useState(false);
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
  const recomputeOverflow = () => setOverflows(contentH.current > viewportH.current + 1);
  const loaded = !!reveal.data && !("pending" in reveal.data);
  // reveal.data's reference changes on every refetch (staleTime 0 + AppState
  // focus refetches), so the resolved-outcomes effect below can re-run for
  // the same date many times — the guard fires the capture once per date.
  const viewedFor = useRef<string | null>(null);
  // The board exists only once every row carries an outcome — the endpoint
  // 409s before that, for the same reason the day's number is withheld.
  const dayRead = !!reveal.data && !("pending" in reveal.data) && reveal.data.questions.every((q) => q.outcome !== null);
  const board = useRoundBoard(date ?? null, dayRead);

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
      capture("reveal_viewed", { date: d2.date });
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

  if (reveal.isLoading) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <DecodeLine text="CONSULTING THE VOID…" cursor size={10} color={colors.goldText} letterSpacing={4} style={{ textAlign: "center" }} />
      </View>
    </Screen>
  );
  if (reveal.isError) return (
    <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <DecodeLine text="THE ORB IS BEYOND REACH. IT WILL RETURN." size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2} />
    </View></Screen>
  );
  if (!reveal.data || "pending" in reveal.data) {
    return <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <View style={{ alignItems: "center" }}><AsciiDust /></View>
      <Eyebrow>{`Day ${date ?? ""}`}</Eyebrow>
      <Serif size={22} style={{ textAlign: "center" }}>The ledger is not yet read.</Serif>
      <DecodeLine text={pendingLine(date ?? "", new Date().toISOString().slice(0, 10))} cursor size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2} />
    </View></Screen>;
  }

  const d = reveal.data;
  const big = d.questions.find((q) => q.slot === 5);
  const bigState = big ? rowState(big) : null;
  const contrarianWin = !!big?.my && (big.my.points ?? 0) > payoff(big.my.confidence, true).win;
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
  };

  async function onShare() {
    setSharing(true);
    setShareError(null);
    try {
      await shareCard(canvasRef, cardData);
    } catch {
      // Every other failure in this app has a written line; this one used to
      // be swallowed whole, so a failed share simply did nothing.
      setShareError("THE PROPHECY WOULD NOT LEAVE. TRY AGAIN.");
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
      <View style={{ paddingTop: inset.top, paddingLeft: inset.left, paddingRight: inset.right }}>
        <TopBar />
      </View>
      <ScrollView
        contentContainerStyle={{
          gap: space(4),
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
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedInk} colors={[colors.agedGold]} />}
        onLayout={(e) => { viewportH.current = e.nativeEvent.layout.height; recomputeOverflow(); }}
        onContentSizeChange={(_w, h) => { contentH.current = h; recomputeOverflow(); }}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          // Setting the same boolean back is a React bail-out, so this is free
          // on every frame that does not actually cross the end.
          setAtBottom(contentOffset.y + layoutMeasurement.height >= contentSize.height - 1);
        }}
      >
        <Eyebrow>
          {anyPending
            ? `Day ${d.date} · the ledger is still being read`
            : allSpectator
              // The lapsed line directly below says "the ledger was read
              // without you" in full, and with more feeling. Saying it in the
              // eyebrow too printed the same sentence twice, stacked.
              ? `Day ${d.date}`
              : `Day ${d.date} · the ledger is read`}
        </Eyebrow>
        <RevealSummary data={d} milestone={milestone ? MILESTONE_COPY[milestone] : null} />
        {!pointsWithheld(d) && results.some(r => r !== "none") && <GoldButton title={sharing ? "CONJURING…" : "SHARE THE PROPHECY"} onPress={onShare} disabled={sharing} />}
        {shareError && <Mono color={colors.vermilion}>{shareError}</Mono>}
        <QuietLink title={details ? "CLOSE THE DETAILS" : "ALL CALLS AND THE BOARD"} onPress={() => setDetails(!details)} />
        {details && <>
        {allSpectator && !anyPending && (
          <DecodeLine text={lapsedLine(d.date)} size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }} />
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
          {!allSpectator && (pointsWithheld(d) ? (
            <>
              <Ritual bold size={24} color={colors.mutedInk} letterSpacing={3} style={{ marginRight: -3, textAlign: "center" }}>{readingLine(d.questions)}</Ritual>
              <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>DAY POINTS WITHHELD</Mono>
            </>
          ) : (
            <>
              <RollingPoints value={d.day_points} delayMs={POINTS_DELAY} />
              <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>DAY POINTS</Mono>
              {d.rules_version >= 2 && d.bonus_points !== 0 && <Mono size={10}>CROWD BONUS {d.bonus_points} · EXCLUDED FROM DUEL AND RANK</Mono>}
              {/* Both weights on one line. The first hour is not gated on a
                  winning day any more — the bonus is symmetric (design
                  2026-09-03 §2), so gating it on day_points > 0 hid it on
                  exactly the days it cost the player something, which is the
                  one direction it must never be silent in. */}
              {weightLine(d) && (
                <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{weightLine(d)}</Mono>
              )}
            </>
          ))}
          {/* Where the day stood among everyone who played it (design §4).
              Held open at a fixed height because it arrives on its own query,
              after the reveal has already drawn. */}
          {!allSpectator && (
            <View style={{ minHeight: BOARD_SLOT_H, alignItems: "center", justifyContent: "center", gap: space(1) }}>
              {boardLines(board.data ?? undefined).map((line, i) => (
                <Mono
                  key={i}
                  size={10}
                  color={i === 0 && board.data?.your_rank != null ? colors.goldText : colors.mutedInk}
                  letterSpacing={3}
                  style={{ textAlign: "center", lineHeight: BOARD_LINE_H }}
                >
                  {line}
                </Mono>
              ))}
              {/* The field as a room, not only a rank (design §4) — who else
                  is standing near the reader, and where the machine itself
                  landed among them. */}
              {!!board.data?.rows?.length && boardRowLines(board.data.rows).map((line, i) => (
                <Mono
                  key={`row-${i}`}
                  size={10}
                  color={board.data!.rows[i]!.is_you ? colors.goldText : board.data!.rows[i]!.is_oracle ? colors.ink : colors.mutedInk}
                  letterSpacing={2}
                  style={{ textAlign: "center", lineHeight: BOARD_LINE_H }}
                >
                  {line}
                </Mono>
              ))}
            </View>
          )}
          {/* Your standing, which is NOT this day's news — the vigil's count
              and the score are true before the page loads and stay true after
              it. They were gold, which put four gold lines under one number
              and made the block read as four headlines instead of one. Muted
              and set apart, they subordinate to the day without leaving it. */}
          <View style={{ alignItems: "center", gap: space(1), marginTop: space(2) }}>
            {ledgerLines(d.ledger, d.rules_version).map((line, i) => (
              <Mono key={i} size={10} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }}>{line}</Mono>
            ))}
            {/* What the night cost, in candidates. It belongs with the standing
                lines rather than the day's headline: it is a fact about the
                machine, not about this player's day. Null — and therefore
                absent — for a bank drop and for every round authored before
                migration 0007. */}
            {provenanceLine(d.candidates_written, d.candidates_rejected) && (
              <Mono size={10} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }}>
                {provenanceLine(d.candidates_written, d.candidates_rejected)}
              </Mono>
            )}
          </View>
        </Animated.View>
        {/* The day's four ordinary calls, in the card's vocabulary rather
            than a settings list (refinement spec §2): the slot numeral is
            the anchor, the prophecy keeps the temple voice it was asked in,
            and the receipt drops to machine voice underneath it. One rule
            closes the group instead of four rules boxing every row. */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
          {d.questions.filter((q) => q.slot !== 5).map((q, i) => {
            const st = rowState(q);
            const color = st === "win" ? colors.goldText : st === "loss" ? colors.vermilion : colors.mutedInk;
            const receipt = receiptLine(q);
            const call = callLine(q);
            return (
              <Animated.View
                key={q.id}
                entering={FadeInDown.delay(ROW_DELAY + i * ROW_STAGGER).duration(400).easing(easeOut)}
                style={{ flexDirection: "row", gap: space(3), paddingVertical: space(3), alignItems: "flex-start" }}
              >
                <Ritual size={13} color={color} letterSpacing={1} style={{ width: 22, textAlign: "center" }}>
                  {numeral(q.slot)}
                </Ritual>
                <View style={{ flex: 1, gap: space(1) }}>
                  <Serif size={15} color={colors.ink} numberOfLines={3} style={{ lineHeight: 21 }}>{q.text}</Serif>
                  {/* What you said, and what the crowd said — the Big One's
                      block has always read both back; the four ordinary calls
                      showed only their points, so a day later the ledger could
                      not tell you what you had answered. */}
                  {call ? (
                    <Mono size={10} color={colors.mutedInk} style={{ lineHeight: 15 }}>{call}</Mono>
                  ) : null}
                  {q.source_url && <QuietLink title="READ SOURCE" onPress={() => { void Linking.openURL(q.source_url!); }} />}
                  {receipt ? (
                    <Mono size={10} color={colors.mutedInk} numberOfLines={2} style={{ lineHeight: 15 }}>{receipt}</Mono>
                  ) : null}
                </View>
                {/* The mark rides with the value: outcome must never be
                    carried by colour alone (brief §11). */}
                <Mono size={12} color={color} letterSpacing={1}>{`${rowMark(st)} ${rowRight(q)}`}</Mono>
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
                <Ritual bold size={18} color={colors.goldText} letterSpacing={5} style={{ marginRight: -5 }}>{numeral(big.slot)}</Ritual>
                <Ritual bold size={11} letterSpacing={4}>[ ✶ THE BIG ONE ]</Ritual>
              </View>
              <Serif size={17}>{big.text}</Serif>
              {bigState === "pending" && (
                <Mono size={11} color={colors.mutedInk}>{receiptLine(big)}</Mono>
              )}
              {bigState === "void" && (
                <Mono size={11} color={colors.mutedInk}>{receiptLine(big)}</Mono>
              )}
              {bigState !== "pending" && bigState !== "void" && big.crowd_yes_pct !== null && (
                <View style={{ gap: space(1) }}>
                  {big.my && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Mono size={11}>YOU: {big.my.answer ? "YES" : "NO"} @ {big.my.confidence}%</Mono>
                      <Mono size={11} color={(big.my.points ?? 0) >= 0 ? colors.goldText : colors.vermilion}>
                        {(big.my.points ?? 0) > 0 ? `+${big.my.points}` : String(big.my.points ?? "—")}
                      </Mono>
                    </View>
                  )}
                  {/* Same floor as the round footer and the finale: over a
                      handful of players the percentage is mostly the reader,
                      and this frame is the one people screenshot. */}
                  <Mono size={10} color={colors.mutedInk}>{crowdReadable(big) ? `CROWD SAID ${big.crowd_yes_pct}% YES` : TOO_FEW_LINE}</Mono>
                  {big.market_prob != null && (
                    <Mono size={10} color={colors.mutedInk}>THE MARKET SAID {Math.round(big.market_prob * 100)}% YES</Mono>
                  )}
                  {big.oracle_p_yes != null && big.outcome !== "void" && big.outcome !== null && (
                    <Mono size={10} color={colors.mutedInk}>
                      THE ORACLE FORESAW {Math.round(big.oracle_p_yes * 100)}% YES{" "}
                      {oracleCallRight(big.oracle_p_yes, big.outcome) === null
                        ? ""
                        : oracleCallRight(big.oracle_p_yes, big.outcome)
                          ? "✓"
                          : "✗"}
                    </Mono>
                  )}
                  <Mono size={10} color={colors.mutedInk} numberOfLines={2}>{receiptLine(big)}</Mono>
                  {contrarianWin && (
                    <Animated.View entering={FadeIn.delay(BIG_ONE_DELAY + 600).duration(400).easing(easeOut)} style={{ flexDirection: "row", alignItems: "baseline", gap: space(2), justifyContent: "center" }}>
                      <Ritual bold size={14} letterSpacing={3}>AGAINST THE TIDE</Ritual>
                      <Ritual bold size={22} color={colors.agedGold} letterSpacing={1}>+40</Ritual>
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
            <Mono
              size={11}
              letterSpacing={2}
              color={oracleCounts!.you > oracleCounts!.oracle ? colors.goldText : colors.mutedInk}
              style={{ textAlign: "center" }}
            >
              {oracleLine}
            </Mono>
          </Animated.View>
        )}
        </>}
      </ScrollView>
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
