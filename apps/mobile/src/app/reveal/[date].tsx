import { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, Easing, Keyframe, useReducedMotion } from "react-native-reanimated";
import { useLocalSearchParams } from "expo-router";
import { useCanvasRef } from "@shopify/react-native-skia";
import { Screen } from "../../ui/Screen";
import { Serif, Mono, Ritual, Eyebrow } from "../../ui/Text";
import { GoldButton } from "../../ui/Button";
import { GoldFrame } from "../../ui/GoldFrame";
import { TopBar } from "../../ui/TopBar";
import { AsciiDust } from "../../ui/TerminalPatina";
import { DecodeLine } from "../../ui/DecodeText";
import { ShareCardCanvas, shareCard, type ShareCardData } from "../../ui/ShareCard";
import { RollingPoints, ROLL_MS } from "../../ui/RollingPoints";
import type { QuestionResult } from "../../game/sharePattern";
import { payoff } from "@oracle/core";
import { useReveal } from "../../api/hooks";
import { markRevealSeen } from "../../api/flags";
import { rowState, rowMark, rowRight, receiptLine, ledgerLines, pendingLine, lapsedLine } from "../../game/revealRows";
import { capture } from "../../analytics/analytics";
import { colors, space } from "../../theme";

const easeOut = Easing.out(Easing.poly(4));
const ROW_DELAY = 200;
const ROW_STAGGER = 90;
const POINTS_DELAY = ROW_DELAY + 4 * ROW_STAGGER + 200;
const BIG_ONE_DELAY = POINTS_DELAY + 350;

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
  const canvasRef = useCanvasRef();
  const [sharing, setSharing] = useState(false);
  const loaded = !!reveal.data && !("pending" in reveal.data);

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
    capture("reveal_viewed", { date: d2.date });
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
  const cardData: ShareCardData = {
    date: d.date,
    dayPoints: d.day_points,
    bigOneText: big?.text ?? null,
    bigOneCrowdPct: big?.crowd_yes_pct ?? null,
    bigOneMarketPct: big?.market_prob != null ? Math.round(big.market_prob * 100) : null,
    results,
  };

  async function onShare() {
    setSharing(true);
    try { await shareCard(canvasRef, cardData); } catch {} finally { setSharing(false); }
  }

  return (
    <Screen>
      <TopBar />
      <ScrollView contentContainerStyle={{ gap: space(4), paddingBottom: space(6) }}>
        <Eyebrow>
          {anyPending
            ? `Day ${d.date} · the ledger is still being read`
            : allSpectator
              ? `Day ${d.date} · the ledger was read without you`
              : `Day ${d.date} · the ledger is read`}
        </Eyebrow>
        {allSpectator && !anyPending && (
          <DecodeLine text={lapsedLine(d.date)} size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }} />
        )}
        <Animated.View entering={FadeIn.delay(POINTS_DELAY).duration(500).easing(easeOut)} style={{ alignItems: "center", gap: space(1) }}>
          {!allSpectator && (
            <>
              <RollingPoints value={d.day_points} delayMs={POINTS_DELAY} />
              <Mono size={9} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>DAY POINTS</Mono>
              {d.first_hour && d.day_points > 0 && (
                <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>FIRST HOUR +10%</Mono>
              )}
            </>
          )}
          {ledgerLines(d.ledger).map((line, i) => (
            <Mono key={i} size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </Animated.View>
        <View>
          {d.questions.filter((q) => q.slot !== 5).map((q, i) => {
            const st = rowState(q);
            const color = st === "win" ? colors.goldText : st === "loss" ? colors.vermilion : colors.mutedInk;
            return (
              <Animated.View key={q.id} entering={FadeInDown.delay(ROW_DELAY + i * ROW_STAGGER).duration(400).easing(easeOut)}
                style={{ flexDirection: "row", gap: space(2), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft, alignItems: "baseline" }}>
                <Mono size={12} color={color}>{rowMark(st)}</Mono>
                <View style={{ flex: 1 }}>
                  <Mono size={11} color={colors.mutedInk} numberOfLines={2}>{q.text}</Mono>
                  <Mono size={9} color={colors.mutedInk} numberOfLines={2}>{receiptLine(q)}</Mono>
                </View>
                <Mono size={12} color={color}>{rowRight(q)}</Mono>
              </Animated.View>
            );
          })}
        </View>
        {big && (
          <Animated.View entering={FadeInDown.delay(BIG_ONE_DELAY).duration(500).easing(easeOut)}>
          <GoldFrame style={{ backgroundColor: colors.goldWash }}>
            {contrarianWin && !reducedMotion && (
              <Animated.View pointerEvents="none" entering={TideFlash} style={[StyleSheet.absoluteFill, { backgroundColor: colors.goldWash }]} />
            )}
            {/* Temple voice: art sits inside the frame, never behind body text (spec §3b). */}
            <View style={{ height: 110, overflow: "hidden" }}>
              <Image
                source={require("../../../assets/art/orb-pointing-hand.jpg")}
                contentFit="cover"
                contentPosition={{ top: "40%", left: "50%" }}
                style={{ width: "100%", height: "100%" }}
                accessible={false}
              />
              <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: colors.line }} />
            </View>
            <View style={{ padding: space(3), gap: space(2) }}>
              <Ritual bold size={11} letterSpacing={4}>✶ THE BIG ONE</Ritual>
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
                  <Mono size={10} color={colors.mutedInk}>CROWD SAID {big.crowd_yes_pct}% YES</Mono>
                  {big.market_prob != null && (
                    <Mono size={10} color={colors.mutedInk}>THE MARKET SAID {Math.round(big.market_prob * 100)}% YES</Mono>
                  )}
                  {big.oracle_p_yes != null && (
                    <Mono size={10} color={colors.mutedInk}>THE ORACLE FORESAW {Math.round(big.oracle_p_yes * 100)}% YES</Mono>
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
        {results.some((r) => r !== "none") && (
          <Animated.View entering={FadeIn.delay(BIG_ONE_DELAY + 300).duration(400).easing(easeOut)}>
            <GoldButton title={sharing ? "CONJURING…" : "SHARE THE PROPHECY"} onPress={onShare} disabled={sharing} />
          </Animated.View>
        )}
      </ScrollView>
      <ShareCardCanvas canvasRef={canvasRef} data={cardData} />
    </Screen>
  );
}
