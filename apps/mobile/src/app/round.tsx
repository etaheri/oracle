import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
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
import { trayTiles, trayState, trayStage, DOUBLE_FAILED, TRAY_HOLD_MS } from "../game/doubleTray";
import { capture } from "../analytics/analytics";
import { SleepsPanel } from "../ui/SleepsPanel";
import { AsciiDust } from "../ui/TerminalPatina";
import { DecodeLine } from "../ui/DecodeText";
import { numeral } from "../ui/CardChrome";
import { useToday, useCrowdSoFar, useMineToday, useDouble } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { colors, space } from "../theme";
import { useChromeScale } from "../ui/useChromeScale";
import { scaledRow } from "../game/typeScaling";
import { PIPELINE_LINES } from "@oracle/core";
import { useRouter } from "expo-router";

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
  // The last thrown card's id: its crowd verdict prints in the stationary
  // footer while the next card is contemplated — every seal pays out
  // immediately, and the full spread stays the finale.
  const [lastSealedId, setLastSealedId] = useState<string | null>(null);
  // The receipt the card handed back at the seal — "YES · STAKED 50 · WINS
  // 93" — printed in the footer's slot while the next card is contemplated.
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);
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
    AccessibilityInfo.announceForAccessibility(`The players: ${crowdVerdict(entry.answer, c.crowd_yes_pct, c.player_count).line}`);
  }, [lastSealedId, answers, crowd.data]);
  const chromeScale = useChromeScale();
  const minePreds = mine.data?.predictions ?? [];
  // The server's row is the truth; `placedId` only covers the beat between
  // the mutation landing and /today/mine coming back carrying it.
  const doubleId = mine.data?.double_question_id ?? placedId;
  const tray = trayDone ? "placed" : trayState(qs, minePreds, doubleId, now);
  const tiles = trayTiles(qs, minePreds, now);
  const current = nextOpenQuestion(qs, (id) => !!answers[id]?.sealed, now);
  // Card, tray, an empty beat, or the finale — see trayStage for why the
  // empty beat exists.
  const stage = trayStage({
    hasOpenCard: !!current,
    tray,
    // `isPending` too: between the query becoming enabled and its first
    // fetch actually starting, `isFetching` is still false and the hand is
    // no more known than it is mid-flight. Both go false on an error, so a
    // failed /today/mine falls through to the finale rather than hanging.
    mineSettled: !mine.isFetching && !mine.isPending,
    holdPlaced: !trayDone && placedId !== null,
  });
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
  const verdict = lastEntry && lastCrowd ? crowdVerdict(lastEntry.answer, lastCrowd.crowd_yes_pct, lastCrowd.player_count) : null;
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
                fortune={today.data?.fortune ?? null}
                onSealed={(receipt) => { setLastSealedId(current.id); setLastReceipt(receipt); }}
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
            <CrowdReveal round={today.data} />
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
      <View style={{ minHeight: scaledRow(56, chromeScale), justifyContent: "center" }}>
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
          </View>
        ) : current ? (
          <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "center" }]}>
            The players' leaning is hidden until you seal.
          </Mono>
        ) : null}
      </View>
      </>}
    </Screen>
  );
}
