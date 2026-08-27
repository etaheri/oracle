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
import { ShareCardCanvas, shareCard, type ShareCardData } from "../../ui/ShareCard";
import { RollingPoints, ROLL_MS } from "../../ui/RollingPoints";
import type { QuestionResult } from "../../game/sharePattern";
import { useReveal } from "../../api/hooks";
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
    const big2 = d2 && !("pending" in d2) ? d2.questions.find((q) => q.slot === 5) : undefined;
    const side = big2?.my && big2.crowd_yes_pct !== null ? (big2.my.answer ? big2.crowd_yes_pct : 100 - big2.crowd_yes_pct) : null;
    const tide = side !== null && side < 40 && (big2?.my?.points ?? 0) > 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), reducedMotion ? 0 : POINTS_DELAY + ROLL_MS));
    if (tide && !reducedMotion) {
      timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), BIG_ONE_DELAY + 650));
      timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), BIG_ONE_DELAY + 800));
    }
    return () => timers.forEach(clearTimeout);
  }, [loaded, reducedMotion, reveal.data]);

  if (reveal.isLoading) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <Eyebrow>Consulting the void…</Eyebrow>
      </View>
    </Screen>
  );
  if (reveal.isError) return (
    <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <Mono size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>THE ORB IS BEYOND REACH. IT WILL RETURN.</Mono>
    </View></Screen>
  );
  if (!reveal.data || "pending" in reveal.data) {
    return <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <View style={{ alignItems: "center" }}><AsciiDust /></View>
      <Eyebrow>{`Day ${date ?? ""}`}</Eyebrow>
      <Serif size={22} style={{ textAlign: "center" }}>The ledger is not yet read.</Serif>
      <Mono size={11} color={colors.mutedInk} style={{ textAlign: "center" }}>Return at noon.</Mono>
    </View></Screen>;
  }

  const d = reveal.data;
  const big = d.questions.find((q) => q.slot === 5);
  const bigSide = big?.my && big.crowd_yes_pct !== null ? (big.my.answer ? big.crowd_yes_pct : 100 - big.crowd_yes_pct) : null;
  const contrarianWin = bigSide !== null && bigSide < 40 && (big?.my?.points ?? 0) > 0;
  const results = [...d.questions].sort((a, b) => a.slot - b.slot).map((q): QuestionResult =>
    !q.my ? "none" : q.outcome === "void" ? "void" : (q.my.points ?? 0) > 0 ? "win" : "loss");
  const cardData: ShareCardData = {
    date: d.date,
    dayPoints: d.day_points,
    bigOneText: big?.text ?? null,
    bigOneCrowdPct: big?.crowd_yes_pct ?? null,
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
        <Eyebrow>{`Day ${d.date} · the ledger is read`}</Eyebrow>
        <Animated.View entering={FadeIn.delay(POINTS_DELAY).duration(500).easing(easeOut)} style={{ alignItems: "center", gap: space(1) }}>
          <RollingPoints value={d.day_points} delayMs={POINTS_DELAY} />
          <Mono size={9} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>DAY POINTS</Mono>
          {d.first_hour && d.day_points > 0 && (
            <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>FIRST HOUR +10%</Mono>
          )}
        </Animated.View>
        <View>
          {d.questions.filter((q) => q.slot !== 5).map((q, i) => {
            const won = q.my && q.outcome !== "void" && q.my.points !== null && q.my.points > 0;
            const mark = q.outcome === "void" ? "∅" : won ? "✓" : q.my ? "✗" : "·";
            const color = q.outcome === "void" ? colors.mutedInk : won ? colors.goldText : q.my ? colors.vermilion : colors.mutedInk;
            return (
              <Animated.View key={q.id} entering={FadeInDown.delay(ROW_DELAY + i * ROW_STAGGER).duration(400).easing(easeOut)}
                style={{ flexDirection: "row", gap: space(2), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft, alignItems: "baseline" }}>
                <Mono size={12} color={color}>{mark}</Mono>
                <Mono size={11} color={colors.mutedInk} style={{ flex: 1 }} numberOfLines={2}>{q.text}</Mono>
                <Mono size={12} color={color}>{q.my?.points != null ? (q.my.points > 0 ? `+${q.my.points}` : String(q.my.points)) : "—"}</Mono>
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
              {big.my && big.crowd_yes_pct !== null && (
                <View style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Mono size={11}>YOU: {big.my.answer ? "YES" : "NO"} @ {big.my.confidence}%</Mono>
                    <Mono size={11} color={(big.my.points ?? 0) >= 0 ? colors.goldText : colors.vermilion}>
                      {(big.my.points ?? 0) > 0 ? `+${big.my.points}` : String(big.my.points ?? "—")}
                    </Mono>
                  </View>
                  <Mono size={10} color={colors.mutedInk}>CROWD SAID {big.crowd_yes_pct}% YES</Mono>
                  {contrarianWin && (
                    <Animated.View entering={FadeIn.delay(BIG_ONE_DELAY + 600).duration(400).easing(easeOut)} style={{ flexDirection: "row", alignItems: "baseline", gap: space(2), justifyContent: "center" }}>
                      <Ritual bold size={14} letterSpacing={3}>AGAINST THE TIDE</Ritual>
                      <Ritual bold size={22} color={colors.agedGold} letterSpacing={1}>×2</Ritual>
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
