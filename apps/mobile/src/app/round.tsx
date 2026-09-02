import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import Animated, { Easing, FadeIn, Keyframe, useReducedMotion } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { Screen } from "../ui/Screen";
import { Mono, Ritual } from "../ui/Text";
import { TopBar } from "../ui/TopBar";
import { OracleCard } from "../ui/OracleCard";
import { UndealtCard, STACK_TOP_Y, STACK_TOP_ROTATE } from "../ui/UndealtCard";
import { ConvictionColumn } from "../ui/ConvictionColumn";
import { confidenceReading } from "../game/confidence";
import { crowdVerdict } from "../game/crowdVerdict";
import { payoffLine } from "../game/payoffLine";
import { isClosed, nextOpenQuestion } from "../game/questionState";
import { CrowdReveal, CrowdBar } from "../ui/CrowdReveal";
import { SleepsPanel } from "../ui/SleepsPanel";
import { AsciiDust } from "../ui/TerminalPatina";
import { DecodeLine } from "../ui/DecodeText";
import { numeral } from "../ui/CardChrome";
import { useToday, useCrowdSoFar } from "../api/hooks";
import { getFloorNoticed, markFloorNoticed } from "../api/flags";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { maybeSummon } from "../notifications/summons";
import { colors, space } from "../theme";
import { useChromeScale } from "../ui/useChromeScale";
import { scaledRow } from "../game/typeScaling";

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
  // The card's live pull, lifted to the screen: the conviction column and
  // the footer reading are stationary while the card moves.
  const [lean, setLean] = useState<{ conf: number | null; side: boolean; active: boolean }>({ conf: null, side: true, active: false });
  // Stable identity + no-op bailout: the card reports its lean on every
  // change; an inline handler here would re-render forever.
  const onLean = useCallback((conf: number | null, side: boolean, active: boolean) => {
    setLean((prev) => (prev.conf === conf && prev.side === side && prev.active === active ? prev : { conf, side, active }));
  }, []);
  // The floor rite: the first committed pull EVER reads "NO COIN FLIPS · 55
  // IS THE LEAST BELIEF" in the reading's slot — the scale explains itself
  // at the exact moment every player first meets its floor, then never
  // again. Defaults seen so the rite can't flash for veterans while the
  // flag loads.
  const [floorSeen, setFloorSeen] = useState(true);
  const floorShown = useRef(false);
  // Per-question early locks mean "closed" is time-dependent — recomputed
  // every 30s, not just at fetch time, so a card that locks mid-session
  // is skipped without a refetch.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { void getFloorNoticed().then(setFloorSeen); }, []);
  useEffect(() => {
    if (lean.conf !== null && !floorSeen) floorShown.current = true;
    if (lean.conf === null && floorShown.current && !floorSeen) {
      setFloorSeen(true);
      void markFloorNoticed();
    }
  }, [lean.conf, floorSeen]);

  const qs = [...(today.data?.questions ?? [])].sort((a, b) => a.slot - b.slot);
  const anySealed = qs.some((q) => answers[q.id]?.sealed);
  const allSealed = qs.length > 0 && qs.every((q) => answers[q.id]?.sealed);
  // The summons, the moment the spread is fully sealed for the first time
  // this mount — once, ever, across the whole app (voice spec §4).
  const summoned = useRef(false);
  useEffect(() => {
    if (allSealed && !summoned.current) { summoned.current = true; void maybeSummon((href) => router.push(href)); }
  }, [allSealed]);
  const crowd = useCrowdSoFar(anySealed);
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
    AccessibilityInfo.announceForAccessibility(`The crowd: ${crowdVerdict(entry.answer, c.crowd_yes_pct, c.player_count).line}`);
  }, [lastSealedId, answers, crowd.data]);
  const chromeScale = useChromeScale();

  if (today.isLoading) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <DecodeLine text="THE ORACLE IS CONSULTED" cursor size={10} color={colors.goldText} letterSpacing={4} style={{ textAlign: "center" }} />
      </View>
    </Screen>
  );
  if (!today.data) return <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center" }}><SleepsPanel /></View></Screen>;

  const crowdById = new Map((crowd.data?.questions ?? []).map((c) => [c.id, c]));
  const current = nextOpenQuestion(qs, (id) => !!answers[id]?.sealed, now);
  const lastEntry = lastSealedId ? answers[lastSealedId] : undefined;
  const lastCrowd = lastSealedId ? crowdById.get(lastSealedId) : undefined;
  const verdict = lastEntry && lastCrowd ? crowdVerdict(lastEntry.answer, lastCrowd.crowd_yes_pct, lastCrowd.player_count) : null;

  return (
    <Screen>
      <TopBar label={`DAY ${today.data.date}`} />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        {current ? (
          <View>
            {/* The rest of the deck: full undealt cards beneath the live one,
                their prophecies still static — so a mid-swipe glance shows a
                real stack, not slivers, and nothing unspoiled is spoiled. */}
            {qs.filter((q) => q.id !== current.id && !answers[q.id]?.sealed).slice(0, 2).reverse().map((q, i, arr) => (
              <UndealtCard key={q.id} q={q} index={arr.length - 1 - i} />
            ))}
            <Animated.View key={current.id} entering={reducedMotion ? FadeIn.duration(200) : Uncover}>
              <OracleCard
                q={current}
                roundLocksAt={today.data.locks_at}
                onSealed={() => setLastSealedId(current.id)}
                onLean={onLean}
              />
            </Animated.View>
          </View>
        ) : (
          <CrowdReveal round={today.data} />
        )}
      </View>
      {(lean.active || lean.conf !== null) && <ConvictionColumn conf={lean.conf} side={lean.side} />}
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
              color={struck ? colors.mutedInk : sealed ? colors.goldText : "rgba(23,25,31,0.22)"}
              letterSpacing={1}
              style={struck ? { textDecorationLine: "line-through" } : undefined}
              accessibilityLabel={`question ${q.slot}: ${struck ? "closed" : answers[q.id]?.sealed ? "sealed" : "open"}`}
            >
              {numeral(q.slot)}
            </Ritual>
          );
        })}
      </View>
      {/* One fixed-height footer slot: reading, verdict, and hint trade
          places without nudging the layout above them. */}
      <View style={{ height: scaledRow(40, chromeScale), justifyContent: "center" }}>
        {lean.conf !== null ? (
          // The oracle reads the pull aloud — stationary, in the footer's
          // slot — with the honest stake printed underneath: what this
          // conviction pays if right, costs if wrong.
          <View style={{ alignItems: "center", gap: 2 }}>
            <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>
              {floorSeen ? confidenceReading(lean.conf) : "NO COIN FLIPS · 55 IS THE LEAST BELIEF"}
            </Mono>
            <Mono size={10} color={colors.mutedInk} letterSpacing={1}>
              {payoffLine(lean.conf, current?.is_big_one ?? false)}
            </Mono>
          </View>
        ) : current && lastSealedId && lastEntry ? (
          // The seal's payout: the thrown card's crowd verdict, printing while
          // the next card deals. Gold only when the contrarian multiplier is
          // truly in play.
          verdict && lastCrowd ? (
            <View key={lastSealedId} style={{ flexDirection: "row", gap: space(2), justifyContent: "center", alignItems: "center" }}>
              <CrowdBar pct={lastCrowd.crowd_yes_pct} />
              <DecodeLine text={verdict.line} size={10} color={verdict.against ? colors.goldText : colors.mutedInk} letterSpacing={1} />
            </View>
          ) : (
            <DecodeLine text="CONSULTING THE CROWD…" cursor size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }} />
          )
        ) : current ? (
          <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }}>
            The crowd's leaning is hidden until you commit.
          </Mono>
        ) : null}
      </View>
    </Screen>
  );
}
