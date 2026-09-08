import { useCallback, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { RITES_LINES, RITES_V2_SECTIONS, INTRO_LINES, CURRENT_GAME_COPY, GAME_TERMS } from "@oracle/core";
import { useToday, useMineToday } from "../api/hooks";
import { markRitesSeen } from "../api/flags";
import { arrivalInputForRound, arrivalState } from "../game/arrivalState";
import { beginHomeAction, invalidateHomeAction, ownsHomeAction, type HomeActionGate } from "../game/homeActionGate";
import { ReadingHeader } from "../ui/ReadingHeader";
import { Screen, useScreenInset } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Serif } from "../ui/Text";
import { GoldButton, QuietLink } from "../ui/Button";
import { colors, space } from "../theme";

/** Short first-round instructions and a readable, explicitly versioned reference. */
export default function Rites() {
  const router = useRouter();
  const { all, rules_version } = useLocalSearchParams<{ all?: string; rules_version?: string }>();
  const opening = all !== "1";
  const archived = !opening && rules_version === "1";
  const today = useToday();
  const mine = useMineToday(opening);
  const actionGate = useRef<HomeActionGate>({ generation: 0, pending: false, focused: false });
  const [checking, setChecking] = useState(false);
  const inset = useScreenInset();
  const [headerHeight, setHeaderHeight] = useState(inset.top + 44);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  useFocusEffect(useCallback(() => {
    actionGate.current = invalidateHomeAction(actionGate.current, true);
    setChecking(false);
    return () => {
      // Blur and unmount invalidate ownership without updating an inactive screen.
      actionGate.current = invalidateHomeAction(actionGate.current, false);
    };
  }, []));
  const leaveRites = (navigate: () => void) => {
    actionGate.current = invalidateHomeAction(actionGate.current, false);
    setChecking(false);
    navigate();
  };
  const exhibition = () => leaveRites(() => router.push({ pathname: "/practice", params: {
    opening: opening ? "1" : "0", entry_point: opening ? "first_round" : "how_to_play",
  } }));

  const begin = async () => {
    const started = beginHomeAction(actionGate.current);
    if (!started) return;
    actionGate.current = started.gate;
    setChecking(true);
    try {
      const [round, answers] = await Promise.all([today.refetch(), mine.refetch()]);
      if (!ownsHomeAction(actionGate.current, started.token)) return;
      await markRitesSeen();
      if (!ownsHomeAction(actionGate.current, started.token)) return;
      const state = arrivalState(arrivalInputForRound(
        round.data, new Set(answers.data?.predictions.map(p => p.question_id) ?? []), Date.now(),
        { loading: false, failed: round.isError || answers.isError,
          hydrated: !answers.isError, firstVisit: true, nextOpensAt: null },
      ));
      if (state.primary === "live" || state.primary === "crowd") leaveRites(() => router.replace("/round"));
      else if (state.primary === "exhibition") leaveRites(() => router.replace({ pathname: "/practice", params: { opening: "1", entry_point: "first_round" } }));
      else leaveRites(() => router.replace("/"));
    } catch {
      if (ownsHomeAction(actionGate.current, started.token)) leaveRites(() => router.replace("/"));
    } finally {
      if (ownsHomeAction(actionGate.current, started.token)) {
        actionGate.current = invalidateHomeAction(actionGate.current, true);
        setChecking(false);
      }
    }
  };

  return (
    <Screen bleed>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{
        flexGrow: 1, paddingTop: headerHeight + space(4), paddingLeft: inset.left,
        paddingRight: inset.right, paddingBottom: opening ? space(4) : inset.bottom, gap: space(4),
      }} scrollEventThrottle={16} onScroll={event => setHeaderScrolled(event.nativeEvent.contentOffset.y > 2)}
        scrollIndicatorInsets={{ top: headerHeight }} showsVerticalScrollIndicator
        contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
        <Eyebrow>{opening ? "Your first round" : GAME_TERMS.rulesTitle}</Eyebrow>
        {!opening && <Mono size={13}>{GAME_TERMS.rulesNav}{archived ? " · Archived rules, version 1" : ""}</Mono>}
        {!archived && <Serif size={22} accessibilityRole="header">{CURRENT_GAME_COPY.purpose}</Serif>}
        {opening ? INTRO_LINES.map((line, i) => (
          <View key={line} style={{ gap: space(1) }}>
            <Mono size={12} color={colors.goldText}>STEP {i + 1}</Mono>
            <Mono size={14} maxFontSizeMultiplier={0} color={colors.ink} letterSpacing={0} style={{ lineHeight: 23 }}>{line}</Mono>
          </View>
        )) : archived ? RITES_LINES.map((line, i) => (
          <Mono key={line} size={13} maxFontSizeMultiplier={0} color={colors.ink} letterSpacing={0}>{i + 1}. {line}</Mono>
        )) : RITES_V2_SECTIONS.map(section => (
          <View key={section.title} style={{ gap: space(2) }}>
            <Serif size={20} accessibilityRole="header">{section.title}</Serif>
            <Mono size={14} maxFontSizeMultiplier={0} color={colors.ink} letterSpacing={0} style={{ lineHeight: 23 }}>{section.text}</Mono>
          </View>
        ))}
        <Mono size={13}>One practice question. Immediate result. Unranked.</Mono>
        <QuietLink title="TRY AN EXHIBITION" onPress={exhibition} />
        {opening && <QuietLink title="HOW TO PLAY" onPress={() => leaveRites(() => router.push({ pathname: "/rites", params: { all: "1" } }))} />}
      </ScrollView>
      {opening && <View style={{ paddingTop: space(3), paddingBottom: inset.bottom, paddingLeft: inset.left, paddingRight: inset.right }}>
        <GoldButton title={checking ? "CHECKING ROUND…" : "BEGIN"} disabled={checking} onPress={() => { void begin(); }} />
      </View>}
      <ReadingHeader inset={inset} scrolled={headerScrolled} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}><TopBar showReturn={!opening} /></ReadingHeader>
    </Screen>
  );
}
