import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { Easing, FadeIn, Keyframe, useReducedMotion } from "react-native-reanimated";
import { Screen } from "../ui/Screen";
import { Mono, Ritual, role } from "../ui/Text";
import { TopBar } from "../ui/TopBar";
import { CardStage } from "../ui/CardStage";
import { OracleCard } from "../ui/OracleCard";
import { UndealtCard, STACK_TOP_Y, STACK_TOP_ROTATE } from "../ui/UndealtCard";
import { crowdVerdict } from "../game/crowdVerdict";
import { crowdAnticipation } from "../game/crowdAnticipation";
import { isClosed, nextOpenQuestion } from "../game/questionState";
import { CrowdReveal, CrowdBar } from "../ui/CrowdReveal";
import { DoubleTray } from "../ui/DoubleTray";
import { trayTiles, trayState, trayStage, handKnown, DOUBLE_FAILED, TRAY_HOLD_MS, TRAY_TITLE } from "../game/doubleTray";
import { capture } from "../analytics/analytics";
import { receiptLine } from "../game/stakeText";
import { SleepsPanel } from "../ui/SleepsPanel";
import { AsciiDust } from "../ui/TerminalPatina";
import { DecodeLine } from "../ui/DecodeText";
import { numeral } from "../ui/CardChrome";
import { useToday, useCrowdSoFar, useMineToday, useDouble, useTodayLog } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { colors, space } from "../theme";
import { useChromeScale } from "../ui/useChromeScale";
import { scaledRow } from "../game/typeScaling";
import { PIPELINE_LINES } from "@oracle/core";
import { useRouter } from "expo-router";
import { ChannelLog } from "../ui/ChannelLog";
import { QuietLink } from "../ui/Button";
import { logIndex } from "../game/todayLog";
import { summaryRow } from "../game/channel";

// The throw UNCOVERS the stack — the next card was already on the table as
// the deck's top, so the live card enters from exactly that resting pose: a
// short slide into register, never a deal from off-screen. Its static then
// prints into the question in place. Reduced motion gets a plain 200ms fade.
const Uncover = new Keyframe({
  0: { transform: [{ translateY: STACK_TOP_Y }, { rotate: STACK_TOP_ROTATE }], opacity: 1 },
  100: { transform: [{ translateY: 0 }, { rotate: "0deg" }], opacity: 1, easing: Easing.out(Easing.poly(3)) },
}).duration(240);

export default function Round() {
  const today = useToday();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const answers = useRoundStore((s) => s.answers);
  // The last thrown card and the side it was thrown to. Its channel opens over
  // the next card, its receipt and the room's verdict print in the footer.
  const [lastSealed, setLastSealed] = useState<{ id: string; answer: boolean } | null>(null);
  const lastSealedId = lastSealed?.id ?? null;
  // The channel on the just-sealed take (design 2026-09-25 §6.2). It opens
  // when the log lands and closes on a tap or on the next seal.
  const [logOpen, setLogOpen] = useState(false);
  // Per-question early locks mean "closed" is time-dependent — recomputed
  // every 30s, not just at fetch time, so a card that locks mid-session
  // is skipped without a refetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const qs = [...(today.data?.questions ?? [])].sort((a, b) => a.slot - b.slot);
  const anySealed = qs.some((q) => answers[q.id]?.sealed);
  // The summons does NOT fire here. It used to, on the fifth seal — and
  // `allSealed` flips in the same commit that swaps the live card for the
  // crowd finale, so the permission interstitial pushed itself over the top
  // of the one screen the whole anti-herding wall exists to pay off (audit
  // 2026-09-02 §1.4). Home asks instead, on any focus after a first seal
  // (index.tsx), which puts the question after the crowd has been beheld and
  // covers the partial player who never returns to a finished spread.
  const crowd = useCrowdSoFar(anySealed);
  const mine = useMineToday(!!today.data);
  // The channel for every take the player has sealed, and the line the tray
  // prices the double from. Refetched by every seal (useSubmit).
  const log = useTodayLog(anySealed);
  const logs = useMemo(() => logIndex(log.data), [log.data]);
  const lineOf = (id: string) => logs.get(id)?.line ?? null;
  const lastLog = lastSealedId ? logs.get(lastSealedId) : undefined;
  const lastRoom = (lastSealedId ? qs.find((q) => q.id === lastSealedId)?.crowd : false) ?? false;
  const double = useDouble();
  // After the double lands the tray holds for a beat, then hands over to the
  // crowd finale — the finale is the payoff, the tray is the decision.
  const [placedId, setPlacedId] = useState<string | null>(null);
  const [trayDone, setTrayDone] = useState(false);
  // Set when a tap reached the server and was refused; cleared on the next one.
  const [trayNotice, setTrayNotice] = useState<string | null>(null);
  useHydratePlayedState(!!today.data);
  // The payout reaches screen-reader players too: speak each card's verdict
  // once, when it first resolves (no-op while VoiceOver is off).
  const announcedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!lastSealedId || announcedFor.current === lastSealedId) return;
    const entry = answers[lastSealedId];
    const c = (crowd.data?.questions ?? []).find((q) => q.id === lastSealedId);
    if (!entry || !c) return;
    announcedFor.current = lastSealedId;
    const room = qs.find((q) => q.id === lastSealedId)?.crowd ?? false;
    AccessibilityInfo.announceForAccessibility(`The players: ${crowdVerdict(entry.answer, c.crowd_yes_pct, c.player_count, room).line}`);
  }, [lastSealedId, answers, crowd.data]);
  const chromeScale = useChromeScale();
  const minePreds = mine.data?.predictions ?? [];
  // The server's row is the truth; `placedId` only covers the beat between
  // the mutation landing and /today/mine coming back carrying it.
  const doubleId = mine.data?.double_question_id ?? placedId;
  // The hand is known once the player's rows have landed and the channel has a
  // line for every one of them: the line rides the channel, which the fifth
  // seal refetches, so the tray waits on it the way it waits on /today/mine or
  // it opens with four tiles and grows a fifth. Keyed on what has ARRIVED, not
  // on whether a fetch is in flight — gating on `isFetching` blanked an open
  // tray on every background refetch and after every refused double.
  //
  // The one thing the fetch flags covered that coverage does not: on the fifth
  // seal the local store says sealed before /today/mine has come back, so
  // `minePreds` is a row short of the hand for one round trip and every line it
  // names is present. Count the locally sealed questions and call the hand
  // unknown while they outnumber the server's rows.
  const locallySealed = qs.filter((q) => answers[q.id]?.sealed).length;
  const known = handKnown({
    mineLoaded: mine.data !== undefined || mine.isError,
    sealedIds: minePreds.map((p) => p.question_id),
    hasLog: (id) => logs.has(id),
    logFailed: log.isError,
  }) && (mine.isError || locallySealed <= minePreds.length);
  const tray = trayDone ? "placed" : doubleId !== null || known ? trayState(qs, minePreds, doubleId, lineOf, now) : "hidden";
  const tiles = trayTiles(qs, minePreds, lineOf, now);
  const current = nextOpenQuestion(qs, (id) => !!answers[id]?.sealed, now);
  // Card, tray, an empty beat, or the finale — see trayStage for why the
  // empty beat exists.
  const stage = trayStage({ hasOpenCard: !!current, tray, mineSettled: known, holdPlaced: !trayDone && placedId !== null });
  // The channel opens itself on the take just sealed — over the next card, or
  // over the tray once the fifth is sealed and the Big One's floor would
  // otherwise never be read. Never on the finale: the block is in that frame
  // already. An empty floor has nothing to open for, and the footer's summary
  // row is absent there too.
  const openedLogFor = useRef<string | null>(null);
  useEffect(() => {
    if (!lastSealedId || !lastLog || !lastRoom || openedLogFor.current === lastSealedId) return;
    if (stage !== "card" && stage !== "tray") return;
    if (lastLog.log.length === 0) return;
    openedLogFor.current = lastSealedId;
    setLogOpen(true);
    capture("log_opened", { question_id: lastSealedId, line: lastLog.line });
  }, [lastSealedId, lastLog, lastRoom, stage]);
  // The open panel takes the screen from the reader, so it says so — once, and
  // however it was opened.
  useEffect(() => {
    if (logOpen) AccessibilityInfo.announceForAccessibility("The channel is open.");
  }, [logOpen]);
  // The placed tile holds its DOUBLED mark for a beat, then the stage moves
  // on. In an effect, so leaving mid-beat cancels the timer with it.
  useEffect(() => {
    if (placedId === null || trayDone) return;
    const id = setTimeout(() => setTrayDone(true), TRAY_HOLD_MS);
    return () => clearTimeout(id);
  }, [placedId, trayDone]);
  // Leaving the tray unplaced is allowed (design §5.3) — and is the thing
  // worth counting, so it is reported once, as the screen goes away. The
  // placed beat is not a skip, and neither is a tray the player never saw.
  const trayOpenRef = useRef(false);
  trayOpenRef.current = stage === "tray" && tray === "open";
  const dateRef = useRef(today.data?.date ?? null);
  dateRef.current = today.data?.date ?? null;
  useEffect(() => () => { if (trayOpenRef.current && dateRef.current) capture("double_skipped", { date: dateRef.current }); }, []);

  if (today.isLoading) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <DecodeLine {...role.eyebrow} text="THE ORACLE IS CONSULTED" cursor color={colors.goldText} style={{ textAlign: "center" }}/>
      </View>
    </Screen>
  );
  if (!today.data) return (
    <Screen>
      <TopBar label="OUTSEEN" />
      <View style={{ flex: 1, justifyContent: "center" }}>
        <SleepsPanel
          failed={today.isError}
          onExhibition={() => router.replace({ pathname: "/practice", params: { opening: "0", entry_point: "waiting_home" } })}
        />
      </View>
    </Screen>
  );

  const crowdById = new Map((crowd.data?.questions ?? []).map((c) => [c.id, c]));
  const lastEntry = lastSealedId ? answers[lastSealedId] : undefined;
  const lastCrowd = lastSealedId ? crowdById.get(lastSealedId) : undefined;
  const verdict = lastEntry && lastCrowd ? crowdVerdict(lastEntry.answer, lastCrowd.crowd_yes_pct, lastCrowd.player_count, lastRoom) : null;
  const lastReceipt = lastSealed ? receiptLine({ answer: lastSealed.answer, line: lastLog?.line ?? null, room: lastRoom }) : null;
  const lastSummary = lastRoom && lastLog ? summaryRow(lastLog.log) : null;
  const anticipation = crowdAnticipation(
    Object.entries(answers).map(([questionId, entry]) => ({ questionId, answer: entry.answer, sealed: entry.sealed })),
    crowd.data?.questions ?? [],
  );

  return (
    <Screen>
      <TopBar label={`DAY ${today.data.date}`} />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        {current ? (
          <CardStage stack={32}>{height => <View>
            {/* The rest of the deck: full undealt cards beneath the live one,
                their prophecies still static — so a mid-throw glance shows a
                real stack, not slivers, and nothing unspoiled is spoiled. */}
            {qs.filter((q) => q.id !== current.id && !answers[q.id]?.sealed).slice(0, 2).reverse().map((q, i, arr) => (
              <UndealtCard height={height} key={q.id} q={q} index={arr.length - 1 - i} />
            ))}
            <Animated.View key={current.id} entering={reducedMotion ? FadeIn.duration(200) : Uncover}>
              <OracleCard
                height={height}
                q={current}
                roundLocksAt={today.data?.locks_at ?? null}
                onSealed={(answer) => { setLastSealed({ id: current.id, answer }); setLogOpen(false); }}
              />
            </Animated.View>
          </View>}</CardStage>
        ) : stage === "tray" ? (
          <DoubleTray tiles={tiles} placedId={doubleId} pending={double.isPending} notice={trayNotice} onPlace={(t) => {
            setTrayNotice(null);
            double.mutate({ question_id: t.id }, {
              // The haptic lands with the double, not with the tap: it is the
              // confirmation, and firing it on touch would promise a placement
              // the server has not made yet.
              onSuccess: () => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                setPlacedId(t.id);
                capture("double_placed", { question_id: t.id, is_big_one: t.isBigOne, stake: t.doubledStake });
              },
              // useDouble refetches the hand, which corrects the tray on its
              // own; this is the line for the beat before that lands, and for
              // the failures a refetch cannot explain.
              onError: () => setTrayNotice(DOUBLE_FAILED),
            });
          }} />
        ) : stage === "waiting" ? (
          <View style={{ flex: 1 }} />
        ) : (
          <View style={{ flex: 1, gap: space(2) }}>
            {anticipation && <Mono {...role.caption} color={colors.goldText} style={[role.caption.style, { textAlign: "center" }]}>{anticipation}</Mono>}
            <CrowdReveal round={today.data} logs={logs} />
          </View>
        )}
        {/* The channel on the take just sealed (design 2026-09-25 §6.2). It
            lies over the lower stage rather than resizing it: the next card is
            already dealt beneath, and a card that changed height as the log
            opened and closed would move under the player's thumb. A tap on the
            stage above it, or the link, closes it. It lies over the tray as
            well: the fifth take's floor has no other place to be read, since
            the fifth seal is followed by the double, not by a sixth card.

            The scrim and the panel share one modal wrapper, so a reader that
            opens the channel is inside it and cannot wander back out into the
            card and the numerals behind it. */}
        {(current || stage === "tray") && logOpen && lastLog && lastSealedId && (
          <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
            <Pressable accessibilityRole="button" accessibilityLabel="Close the channel" onPress={() => setLogOpen(false)} style={StyleSheet.absoluteFill} />
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "62%", backgroundColor: colors.museumWhite, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space(3), gap: space(2) }}>
              <ScrollView contentContainerStyle={{ paddingBottom: space(2) }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false} showsVerticalScrollIndicator={false}>
                <ChannelLog key={lastSealedId} date={today.data.date} log={lastLog.log} defaultOpen collapsible={false} />
              </ScrollView>
              <QuietLink title={current ? "DRAW THE NEXT CARD" : TRAY_TITLE} onPress={() => setLogOpen(false)} />
            </View>
          </View>
        )}
      </View>
      {/* A struck question is the most dramatic thing this system does, and without
          this line it happens in silence: the numeral is simply struck, the same
          as a slot the player let expire. Shown only for a struck question the
          player never sealed — that is exactly the strike that needs explaining,
          and a player who sealed in time has nothing to be told. The line printed
          is whatever reason the server stored: a leak reads as a leak, a
          withdrawal reads as a withdrawal — never a fixed cover story. min-height,
          so the line must stay short — see the ≤40 rule in copy-lint. */}
      {current && <>
      <View style={{ minHeight: scaledRow(16, chromeScale), justifyContent: "center" }}>
        {(() => {
          const struckQ = qs.find((q) => q.struck && ((today.data?.rules_version ?? 1) >= 2 || !answers[q.id]?.sealed));
          if (!struckQ) return null;
          const line = (today.data?.rules_version ?? 1) >= 2
            ? (struckQ.struck_reason ?? PIPELINE_LINES.struck)
            : PIPELINE_LINES.lockHealed;
          return (
            <Mono {...role.meta} color={colors.mutedInk} style={{ textAlign: "center" }}>
              {line}
            </Mono>
          );
        })()}
      </View>
      <View style={{ flexDirection: "row", gap: space(4), justifyContent: "center", paddingTop: space(2) }}>
        {qs.map((q) => {
          const sealed = !!answers[q.id]?.sealed;
          // A closed-but-never-sealed slot was missed, not answered — struck
          // through so the numeral tells the truth about it.
          const struck = !sealed && isClosed(q, now);
          return (
            <Ritual
              key={q.id}
              size={12}
              color={struck ? colors.mutedInk : sealed ? colors.goldText : colors.unwritten}
              letterSpacing={1}
              style={struck ? { textDecorationLine: "line-through" } : undefined}
              accessibilityLabel={`question ${q.slot}: ${struck ? "closed" : answers[q.id]?.sealed ? "sealed" : "open"}`}
            >
              {numeral(q.slot)}
            </Ritual>
          );
        })}
      </View>
      {/* One fixed-height footer slot: receipt, verdict, and hint trade
          places without nudging the layout above them. */}
      <View style={{ minHeight: scaledRow(72, chromeScale), justifyContent: "center" }}>
        {current && lastSealedId && lastEntry ? (
          // The seal's payout, two rows: the receipt the card handed back —
          // side, stake, winnings — over the thrown card's verdict, printing
          // while the next card deals. Gold only when the contrarian
          // multiplier is truly in play.
          <View style={{ alignItems: "center", gap: 2 }}>
            {lastReceipt && (
              <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{lastReceipt}</Mono>
            )}
            {verdict && lastCrowd ? (
              <View key={lastSealedId} style={{ flexDirection: "row", gap: space(2), justifyContent: "center", alignItems: "center" }}>
                <CrowdBar pct={lastCrowd.crowd_yes_pct} />
                <DecodeLine {...role.caption} text={verdict.line} color={verdict.against ? colors.goldText : colors.mutedInk}/>
              </View>
            ) : (
              <DecodeLine {...role.meta} text="COUNTING THE PLAYERS…" cursor color={colors.mutedInk} style={{ textAlign: "center" }}/>
            )}
            {lastSummary && !logOpen && (
              <Pressable accessibilityRole="button" accessibilityLabel="Open the channel" hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }} onPress={() => setLogOpen(true)}>
                <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textDecorationLine: "underline" }]}>{lastSummary}</Mono>
              </Pressable>
            )}
          </View>
        ) : current ? (
          <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "center" }]}>
            {current.crowd ? "Nothing about the room shows until you seal." : "The players' leaning is hidden until you seal."}
          </Mono>
        ) : null}
      </View>
      </>}
    </Screen>
  );
}
