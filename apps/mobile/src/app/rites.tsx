import { useCallback, useRef, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { RITES_LINES, RITES_V2_SECTIONS, INTRO_LINES, LITURGY_LINES, CURRENT_GAME_COPY, GAME_TERMS } from "@oracle/core";
import { useToday, useMineToday } from "../api/hooks";
import { markRitesSeen } from "../api/flags";
import { arrivalInputForRound, arrivalState } from "../game/arrivalState";
import { beginHomeAction, invalidateHomeAction, ownsHomeAction, type HomeActionGate } from "../game/homeActionGate";
import { ReadingHeader } from "../ui/ReadingHeader";
import { Screen, useScreenInset } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual, Serif, role } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { ClaimList } from "../ui/ClaimText";
import { AsciiField } from "../ui/TerminalPatina";
import { numeral } from "../ui/CardChrome";
import { useChromeScale } from "../ui/useChromeScale";
import { GoldButton, QuietLink } from "../ui/Button";
import { colors, space, ROW_H, displayScale } from "../theme";

// The Rites: the rules, in two registers.
//
// The page is a spine and a column. The SPINE is the machine talking about
// itself -- a carved numeral in the margin, a stamp in tracked caps, a gold
// tick under it. It is recognised, not read, so it can afford the caps, the
// tracking and the print effect. The COLUMN is the machine explaining itself
// to a person, and it is set to be read: sentence case, near-zero tracking,
// one claim to a row.
//
// The split is also what decides where the effects go. Printing a stamp out
// of ASCII static costs nothing -- three words you were going to recognise
// anyway. Printing a twenty-word rule would put a second of unreadable noise
// inside the sentence someone is trying to understand. So the decode lives on
// the spine and the column simply arrives, which is not a compromise between
// ceremony and clarity so much as the only place each one actually works.

// Both are set to a shared line box and aligned on the baseline, so the
// numeral sits ON the stamp's line rather than hanging from the top of the
// row -- the same fix the v1 rites needed, kept here because the numeral is
// now deliberately larger than the stamp and cannot rely on matching caps.
const STAMP_LINE_H = 20;
const NUMERAL_SIZE = 16;

// The margin is a reserved slot: XVI is the widest numeral the archived canon
// prints, four Cinzel glyphs plus tracking, and it has to survive the reader
// turning their text size up. 40 at 1x, growing with the capped chrome scale.
const GUTTER_BASE = 40;

function SectionRule() {
  return <View style={{ width: 24, height: 1, backgroundColor: colors.agedGold, opacity: 0.55 }} />;
}

// One rite: the spine row, then the column indented to meet the stamp.
function Rite({ index, gutter, stamp, delayMs, children }: {
  index: number;
  gutter: number;
  stamp: string;
  delayMs: number;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: "row", gap: space(3), alignItems: "baseline" }}>
        <Ritual bold size={NUMERAL_SIZE} color={colors.goldText} letterSpacing={1}
          style={{ width: gutter, textAlign: "right", lineHeight: STAMP_LINE_H }}>
          {numeral(index + 1)}
        </Ritual>
        <DecodeLine text={stamp} delayMs={delayMs} durationMs={420} {...role.action}
          color={colors.goldText} style={[role.action.style, { flex: 1, textAlign: "left", lineHeight: STAMP_LINE_H }]} />
      </View>
      <View style={{ paddingLeft: gutter + space(3), gap: space(3) }}>
        <SectionRule />
        {children}
      </View>
    </View>
  );
}

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
  const gutter = Math.ceil(GUTTER_BASE * useChromeScale());
  const { height: windowHeight } = useWindowDimensions();
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
      {/* The patina is pinned to the margin the numerals stand in, never over
          the column. Glyphs collecting where the machine marks the page is
          the brief's "digital shadow"; glyphs behind a rule someone is trying
          to read is just noise with a good story. One canvas fixed to the
          viewport rather than one per rite: it does not scroll, so a long
          canon costs exactly as much as a short one. */}
      <View style={{ position: "absolute", left: 0, top: 0, opacity: 0.55 }} pointerEvents="none">
        <AsciiField width={inset.left + gutter} height={windowHeight} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{
        flexGrow: 1, paddingTop: headerHeight + space(4), paddingLeft: inset.left,
        paddingRight: inset.right, paddingBottom: opening ? space(4) : inset.bottom, gap: space(6),
      }} scrollEventThrottle={16} onScroll={event => setHeaderScrolled(event.nativeEvent.contentOffset.y > 2)}
        scrollIndicatorInsets={{ top: headerHeight }} showsVerticalScrollIndicator
        contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
        <View style={{ gap: space(3) }}>
          {/* One name for the page. The nav label ("How to play") and the
              page title ("The Rites") are a deliberate pair in GAME_TERMS --
              plain on the door, ceremonial in the room -- and printing both
              here spent the split it exists to make. The line under this one
              tells a new arrival what the game is, which is the job the echo
              was pretending to do. */}
          <Eyebrow>{opening ? "Your first round" : GAME_TERMS.rulesTitle}</Eyebrow>
          {/* The version marker was the echo's only load-bearing passenger, so
              it now travels on its own and only when there is a version to
              mark. */}
          {archived && <Mono {...role.meta} color={colors.mutedInk}>ARCHIVED RULES · VERSION 1</Mono>}
          {!archived && <Serif size={displayScale.lead} accessibilityRole="header" style={{ textAlign: "center" }}>{CURRENT_GAME_COPY.purpose}</Serif>}
        </View>

        {opening ? (
          // Three rites, in the register the canon below them already uses.
          //
          // These used to be the one screen that decoded end to end, on the
          // argument that they were short enough to print without costing a
          // reader anything. They are not short — the second rite now carries
          // the gesture as well as the stake — and they were also the one
          // rules screen a first-time player is guaranteed to see, which made
          // caps and a print effect exactly the wrong two choices to spend
          // here. The spine keeps the ceremony; the column is read.
          <View style={{ gap: space(5) }}>
            {INTRO_LINES.map((line, i) => (
              <View key={line} style={{ flexDirection: "row", gap: space(3), alignItems: "baseline" }}>
                <Ritual bold size={NUMERAL_SIZE} color={colors.goldText} letterSpacing={1}
                  style={{ width: gutter, textAlign: "right", lineHeight: ROW_H.reading }}>
                  {numeral(i + 1)}
                </Ritual>
                <Mono {...role.reading} maxFontSizeMultiplier={0} color={colors.ink}
                  style={[role.reading.style, { flex: 1 }]}>{line}</Mono>
              </View>
            ))}
          </View>
        ) : archived ? (
          // The archived canon is a reference, not a performance: numbered in
          // the same carved numerals, and printed already.
          <View style={{ gap: space(3) }}>
            {RITES_LINES.map((line, i) => (
              <View key={line} style={{ flexDirection: "row", gap: space(3), alignItems: "baseline" }}>
                <Ritual size={displayScale.slot} color={colors.goldText} letterSpacing={1}
                  style={{ width: gutter, textAlign: "right", lineHeight: 18 }}>
                  {numeral(i + 1)}
                </Ritual>
                <Mono {...role.line} maxFontSizeMultiplier={0} color={colors.ink}
                  style={{ flex: 1, lineHeight: 18 }}>{line}</Mono>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ gap: space(6) }}>
            {RITES_V2_SECTIONS.map((section, i) => (
              <Rite key={section.title} index={i} gutter={gutter} delayMs={i * 90}
                stamp={section.title.toUpperCase()}>
                <ClaimList claims={section.claims} defines={section.defines} />
              </Rite>
            ))}
          </View>
        )}

        {/* The creed closes the rulebook. It is the one place the page speaks
            without explaining, so it is centred and it does not decode. */}
        <View style={{ gap: space(1), paddingTop: space(2) }}>
          {LITURGY_LINES.map(line => (
            <Mono key={line} {...role.meta} color={colors.mutedInk}>{line}</Mono>
          ))}
        </View>

        <View style={{ gap: space(1) }}>
          <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>ONE PRACTICE QUESTION · IMMEDIATE RESULT · UNRANKED</Mono>
          <QuietLink title="TRY AN EXHIBITION" onPress={exhibition} />
          {opening && <QuietLink title={GAME_TERMS.rulesNav} onPress={() => leaveRites(() => router.push({ pathname: "/rites", params: { all: "1" } }))} />}
        </View>
      </ScrollView>
      {opening && <View style={{ paddingTop: space(3), paddingBottom: inset.bottom, paddingLeft: inset.left, paddingRight: inset.right }}>
        <GoldButton title={checking ? "CHECKING ROUND…" : "MAKE YOUR FIRST CALL"} disabled={checking} onPress={() => { void begin(); }} />
      </View>}
      <ReadingHeader inset={inset} scrolled={headerScrolled} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}><TopBar showReturn={!opening} /></ReadingHeader>
    </Screen>
  );
}
