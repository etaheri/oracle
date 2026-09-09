import { claimFirstLiveSeal } from "../api/flags";
import { capture as captureGameplay } from "../analytics/analytics";
import { useEffect, useRef, useState } from "react";
import { View, Pressable, StyleSheet, useWindowDimensions, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import { useQueryClient } from "@tanstack/react-query";
import Animated, { useSharedValue, useAnimatedStyle, useDerivedValue, withTiming, withSpring, withSequence, withDelay, Easing, useReducedMotion, runOnJS } from "react-native-reanimated";
import { leanRelease, leanStep, holdConfidence, LEAN_DEAD_ZONE, LEAN_FULL } from "../game/swipeLean";
import { useScreenReader } from "../hooks/useScreenReader";
import { getSwipeHinted, markSwipeHinted } from "../api/flags";
import { ApiError } from "../api/client";
import { useSubmit } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { cardStatus } from "../game/cardStatus";
import { useNow } from "../game/useNow";
import { capture } from "../analytics/analytics";
import { colors, space } from "../theme";
import { Mono } from "./Text";
import { CardChrome, numeral } from "./CardChrome";
import { AsciiCharge } from "./TerminalPatina";
import { DecodeLine } from "./DecodeText";
import type { RoundToday } from "@oracle/core";

// The throw IS the seal: release your pull and the card leaves your hand —
// off the screen edge it was pulled toward, accelerating from wherever the
// fingers let go, one heavy thunk at dispatch. No stamp, no pause. The next
// card deals in under it; the crowd's verdict prints in the stationary
// footer. If the oracle refuses the prophecy, the card flies back in.
const THROW_MS = 320;

// The uncovered card's prophecy materializes IN PLACE and in ONE face: the
// exact static it wore in the stack (same seed, same serif, muted ink)
// prints left-to-right into the question's words in ink. No typeface flip,
// no reflow — the card is an artifact whose inscription resolves, and the
// terminal lives in the symbol set and the print cadence, not the font.
// Reduced motion renders the words immediately.
export const QUESTION_FACE = { size: 22, lineHeight: 32 } as const;
const DECODE_DELAY_MS = 250;
const DECODE_MS = 600;

function QuestionFace({ text, seed }: { text: string; seed: string }) {
  return (
    <DecodeLine
      serif
      text={text}
      seed={seed}
      delayMs={DECODE_DELAY_MS}
      durationMs={DECODE_MS}
      size={QUESTION_FACE.size}
      color={colors.ink}
      dimColor={colors.mutedInk}
      style={{ lineHeight: QUESTION_FACE.lineHeight, textAlign: "center" }}
    />
  );
}

export function OracleCard({ q, roundLocksAt, onSealed, onLean, practice, forceButtons = false, height }: {
  practice?: { onSeal: (answer: boolean, confidence: number) => void; context?: string };
  forceButtons?: boolean;
  height?: number;
  q: RoundToday["questions"][number];
  // The round's overall lock (if any): a question whose own lock differs
  // from it closes ahead of the round, and the title says so.
  roundLocksAt: string | null;
  // Fires when the seal ceremony completes and the card has left the stage
  // (or immediately under reduced motion). The store's sealed flag flips
  // here too, so the round advances only after the throw.
  onSealed: () => void;
  // The screen renders the stationary conviction column; the card reports
  // its live lean upward. active = a pull is in progress (from the first
  // slid point, before any conviction resolves); conf = resolved conviction.
  onLean?: (conf: number | null, side: boolean, active: boolean) => void;
}) {
  const { answers, setAnswer, setConfidence, markSealed } = useRoundStore();
  // The throw distance, read live. This was a module-scope
  // Dimensions.get("window").width, captured once at import and never
  // updated — so after a rotation, in an iPad split view or under Stage
  // Manager the card was thrown the previous layout's width and either
  // stopped on screen or flew far past the edge.
  const { width: screenW } = useWindowDimensions();
  const entry = practice ? undefined : answers[q.id];
  const submit = useSubmit();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [thrown, setThrown] = useState(false);
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });
  const reducedMotion = useReducedMotion();
  // Swipe-to-lean: dragging the card face tilts it toward a side; release
  // past the commit threshold SEALS at the pulled conviction. dragX/cardW
  // live on the UI thread; the release decision runs the node-tested game
  // module on JS.
  const dragX = useSharedValue(0);
  const cardW = useSharedValue(0);
  const stepSV = useSharedValue(-1);
  const pullProgress = useDerivedValue(() => (cardW.value > 0 ? dragX.value / cardW.value : 0));
  // The conviction the current pull (or button hold) implies — drives the
  // conviction column and the ratchet haptics.
  const [liveConf, setLiveConf] = useState<number | null>(null);
  const [liveSide, setLiveSide] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  useEffect(() => { onLean?.(liveConf, liveSide, dragActive); }, [liveConf, liveSide, dragActive, onLean]);
  const screenReader = useScreenReader();
  const [showContext, setShowContext] = useState(false);
  const sealed = !!entry?.sealed;
  // The status field ticks at the countdown's cadence — but ONLY while the
  // card is still open. Once it is sealed the string is the constant "ST:
  // SEALED", and a second-by-second re-render of this component repaints two
  // Skia canvases for a line that will never change again.
  const now = useNow(sealed ? null : 1000);
  // The accessible twin: screen-reader and reduced-motion players get the
  // hold-to-charge buttons instead of the drag.
  const buttonsMode = forceButtons || screenReader || reducedMotion;

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: reducedMotion ? 0 : dragX.value },
      { rotate: `${reducedMotion ? 0 : (dragX.value / Math.max(1, cardW.value)) * 8}deg` },
    ],
  }));
  // The side washes bleed in from the first slid point and saturate at the
  // full pull — same tokens as the selected button state, so the gesture and
  // the buttons speak one color language.
  const yesWashStyle = useAnimatedStyle(() => {
    const p = dragX.value / Math.max(1, cardW.value);
    return { opacity: p > LEAN_DEAD_ZONE ? Math.min(1, p / LEAN_FULL) : 0 };
  });
  const noWashStyle = useAnimatedStyle(() => {
    const p = -dragX.value / Math.max(1, cardW.value);
    return { opacity: p > LEAN_DEAD_ZONE ? Math.min(1, p / LEAN_FULL) : 0 };
  });
  // The question recedes as conviction takes the stage — fully by the top of
  // the scale during a pull, and while a hold-to-charge is live.
  const holdDim = liveConf !== null;
  const questionStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(dragX.value) / Math.max(1, cardW.value * LEAN_FULL));
    const drag = 1 - p * 0.9;
    return { opacity: holdDim ? Math.min(drag, 0.08) : drag, transform: [{ scale: 1 - p * 0.05 }] };
  }, [holdDim]);

  function commitLean(dx: number, width: number) {
    const r = leanRelease(dx, width);
    if (!r) { setLiveConf(null); return; }
    void sealWith(r.answer, r.confidence);
  }
  // Ratchet haptics: crossing the commit threshold is a distinct thunk;
  // every conviction step past it (in either direction) is a light tick.
  // The ceiling is 95 — belief stops short of certainty on purpose, and the
  // scale simply stops responding past LEAN_FULL. That silence was the bug:
  // the hand got the same light tick at the top of the scale as in the middle
  // and no signal that further pull was doing nothing. The top step lands a
  // distinct, heavier stop — the ratchet hitting its pin — once per arrival.
  const CEILING_STEP = 8;
  function onStepChange(step: number, prev: number) {
    if (step === -1) { setLiveConf(null); return; }
    setLiveConf(55 + step * 5);
    if (prev === -1) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (step === CEILING_STEP && prev !== CEILING_STEP) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    else void Haptics.selectionAsync();
  }

  const sideSV = useSharedValue(0); // 1 = leaning YES, -1 = NO, 0 = unknown
  // 1 while a sealing release is in flight: tells onFinalize NOT to spring
  // the card home — the throw owns dragX from the moment the fingers let go.
  const sealingSV = useSharedValue(0);
  function resetLean() {
    setLiveConf(null);
    setLiveSide(true);
    setDragActive(false);
  }
  const pan = Gesture.Pan()
    // buttonsMode players seal ONLY through the hold buttons — a stray brush
    // across the face must never commit a prophecy they can't see moving.
    .enabled(!buttonsMode && !thrown && !sealed && !submit.isPending)
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onBegin(() => {
      // Touching alone has no side. Never reuse the previous pull's meter.
      sideSV.value = 0;
      stepSV.value = -1;
      sealingSV.value = 0;
      runOnJS(resetLean)();
    })
    .onUpdate((e) => {
      dragX.value = e.translationX;
      const s = e.translationX > 4 ? 1 : e.translationX < -4 ? -1 : sideSV.value;
      if (s !== sideSV.value) {
        sideSV.value = s;
        runOnJS(setLiveSide)(s === 1);
        runOnJS(setDragActive)(s !== 0);
      }
      const step = leanStep(e.translationX, cardW.value);
      if (step !== stepSV.value) {
        const prev = stepSV.value;
        stepSV.value = step;
        runOnJS(onStepChange)(step, prev);
      }
    })
    .onEnd((e, success) => {
      if (!success) return;
      sealingSV.value = leanStep(e.translationX, cardW.value) !== -1 ? 1 : 0;
      runOnJS(commitLean)(e.translationX, cardW.value);
    })
    .onFinalize(() => {
      // Runs on release AND cancellation: stand down, and spring home ONLY
      // when the release didn't seal — a sealing release throws instead.
      if (sealingSV.value === 0) runOnJS(resetLean)();
      else runOnJS(setDragActive)(false);
      stepSV.value = -1;
      sideSV.value = 0;
      if (reducedMotion) dragX.value = 0;
      else if (sealingSV.value === 0) dragX.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  // Hold-to-charge (buttonsMode): pressing a side charges conviction one
  // grid step at a time, ticking as it climbs; release seals at that
  // conviction. Same metaphor as the pull, no motion required.
  const hold = useRef<{ start: number; timer: ReturnType<typeof setInterval>; last: number } | null>(null);
  function beginHold(answer: boolean) {
    endHoldTimer();
    setLiveSide(answer);
    const start = Date.now();
    hold.current = {
      start,
      last: 55,
      timer: setInterval(() => {
        const c = holdConfidence(Date.now() - start);
        if (hold.current && c !== hold.current.last) {
          hold.current.last = c;
          // Same stop at the ceiling for the hold-to-charge twin.
          if (c === 95) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
          else void Haptics.selectionAsync();
          setLiveConf(c);
        }
      }, 50),
    };
    setLiveConf(55);
  }
  function endHoldTimer() {
    if (hold.current) { clearInterval(hold.current.timer); hold.current = null; }
  }
  function endHold(answer: boolean) {
    if (!hold.current) return;
    const conf = holdConfidence(Date.now() - hold.current.start);
    endHoldTimer();
    void sealWith(answer, conf);
  }
  useEffect(() => endHoldTimer, []);

  // One-time teaching nudge: the very first undecided card ever drifts a
  // few points toward YES and settles, so the hand learns the face is
  // grabbable. Skipped in buttonsMode; never repeats (SecureStore flag).
  useEffect(() => {
    if (practice || buttonsMode || entry) return;
    let cancelled = false;
    void getSwipeHinted().then((seen) => {
      if (seen || cancelled) return;
      void markSwipeHinted();
      dragX.value = withDelay(900, withSequence(withTiming(18, { duration: 320 }), withTiming(0, { duration: 420, easing: Easing.out(Easing.poly(3)) })));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design
  }, []);

  // The round advances only after the throw: the store's sealed flag is the
  // thing that swaps `current`, so it must not flip mid-flight.
  function finishSeal() {
    markSealed(q.id);
    capture("question_answered", { question_id: q.id, is_big_one: q.is_big_one });
    onSealed();
  }

  // Release IS the seal, and the throw IS the ceremony: the moment the pull
  // (or hold) commits, the card is dispatched — one heavy thunk, off the
  // pulled edge, from wherever the fingers let go — while the server call
  // flies with it. On refusal the card flies back in, unsealed, with the
  // error line, pullable again.
  async function sealWith(answer: boolean, confidence: number) {
    setError(null);
    if (!practice) {
      setAnswer(q.id, answer);
      setConfidence(q.id, confidence);
    }
    setLiveConf(null);
    const key = practice ? null : useRoundStore.getState().answers[q.id]!.idempotencyKey;
    let flight: Promise<void> = Promise.resolve();
    if (!reducedMotion) {
      setThrown(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      flight = new Promise<void>((resolve) => {
        dragX.value = withTiming((answer ? 1 : -1) * screenW * 1.2, { duration: THROW_MS, easing: Easing.in(Easing.poly(3)) }, () => {
          runOnJS(resolve)();
        });
      });
    }
    // Practice shares the entire interaction and throw, but exits before
    // submission, live flags, analytics, or persisted round-state writes.
    if (practice) {
      await flight;
      practice.onSeal(answer, confidence);
      return;
    }
    try {
      await submit.mutateAsync({ question_id: q.id, answer, confidence, idempotency_key: key! });
      if (await claimFirstLiveSeal()) captureGameplay("first_live_seal");
      await flight;
      if (reducedMotion) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finishSeal();
    } catch (e) {
      // Let the throw land before the card returns — a mid-air reversal
      // reads as a glitch, a full return reads as the oracle's refusal.
      await flight;
      sealingSV.value = 0;
      setThrown(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (!reducedMotion) dragX.value = withSpring(0, { damping: 16, stiffness: 160 });
      setError(e instanceof ApiError && e.status === 409 ? "THE ORACLE HAS CLOSED" : "THE CONNECTION WAVERS — TRY AGAIN");
      // A 409 means this question closed under us — a stale `today` would
      // keep dealing it. Refetch so the round advances past the dead card.
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: ["round", "today"] });
    }
  }

  // Slot and provenance only. The day used to ride here too, but source_name
  // is unbounded and the card's margin is now one shared row with the live
  // status field — so something had to give, and the date is the redundant
  // half: the round's own TopBar prints DAY <date> a few inches above this.
  const coordinate = `:: ${numeral(q.slot)} / PER ${q.source_name.toUpperCase()}`;
  const closesEarly = roundLocksAt !== null && q.locks_at !== roundLocksAt;
  const title = q.is_big_one ? "✶ THE BIG ONE" : q.category;
  const modifiers = [
    q.is_big_one ? "PAYS DOUBLE · COSTS DOUBLE" : null,
    closesEarly ? "CLOSES EARLY" : null,
  ].filter(Boolean).join(" · ");

  return (
    <View>
      <Animated.View
        style={frontStyle}
        onLayout={(e) => {
          setCardSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
          cardW.value = e.nativeEvent.layout.width;
        }}
      >
        <CardChrome
          height={height}
          slot={q.slot}
          title={title}
          modifiers={modifiers || undefined}
          big={q.is_big_one}
          coordinate={coordinate}
          status={practice ? "EXHIBITION · UNRANKED" : cardStatus(q.locks_at, now, sealed)}
        >
          {/* The question floats centered in the card's field, tarot-fashion;
              the controls anchor at the foot. The face is also the grab
              surface: pull it toward a side and release to seal (buttonsMode
              players hold-to-charge instead). */}
          <GestureDetector gesture={pan}>
            <Animated.View style={[{ flex: 1, minHeight: 0 }, questionStyle]}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
              <QuestionFace text={q.text} seed={q.id} />
              {practice?.context && <Mono size={11} style={{ textAlign: "center" }}>{practice.context}</Mono>}
              {q.context && <View style={{ gap: space(1) }}>
                <Pressable accessibilityRole="button" onPress={() => setShowContext(!showContext)} style={{ minHeight: 44, justifyContent: "center" }}><Mono size={11}>{showContext ? "CLOSE CONTEXT" : "CONTEXT"}</Mono></Pressable>
                {showContext && <><Mono size={11}>{q.context.text}</Mono><Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(q.context!.sourceUrl); }} style={{ minHeight: 44 }}><Mono size={10}>SOURCE · AS OF {new Date(q.context.asOf).toLocaleString()}</Mono></Pressable></>}
              </View>}
              {q.is_big_one && <Mono size={10} style={{ textAlign: "center" }}>DOUBLE POINTS · RIGHT OR WRONG</Mono>}
              </ScrollView>
            </Animated.View>
          </GestureDetector>
          <View style={{ gap: space(3) }}>
            {liveConf === null && !sealed && !thrown ? (
              buttonsMode ? (
                <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>HOLD TO RAISE CONFIDENCE · RELEASE TO SEAL</Mono>
              ) : (
                <DecodeLine text="‹ NO ─ PULL · RELEASE ─ YES ›" size={11} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }} />
              )
            ) : null}
            {buttonsMode && (
              <View style={{ flexDirection: "row", gap: space(2) }}>
                {([true, false] as const).map((v) => {
                  const sel = entry?.answer === v;
                  // Sleeve semantics from the art: YES wears the ultramarine sleeve, NO the vermilion.
                  const tone = v ? colors.ultramarine : colors.vermilion;
                  const wash = v ? colors.ultramarineWash : colors.vermilionWash;
                  return (
                    <Pressable
                      key={String(v)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel }}
                      accessibilityHint="Hold to raise confidence; releasing seals your call."
                      onPressIn={() => beginHold(v)}
                      onPressOut={() => endHold(v)}
                      style={{ flex: 1, borderWidth: 1, borderColor: sel ? tone : colors.line, minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: sel ? wash : "transparent" }}>
                      <Mono size={12} color={sel ? tone : colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>{v ? "YES" : "NO"}</Mono>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {error && <Mono size={11} color={colors.vermilion} style={{ textAlign: "center" }}>{error}</Mono>}
          </View>
        </CardChrome>
        {/* Plain-View wrapper carries pointerEvents="none": an opacity-0 view
            still hit-tests, and reanimated does not reliably forward the
            pointerEvents PROP — a none-wrapper makes the washes untouchable. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.ultramarineWash }, yesWashStyle]} />
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.vermilionWash }, noWashStyle]} />
        </View>
        {(dragActive || liveConf !== null) && !thrown && (
          <AsciiCharge width={cardSize.w} height={cardSize.h} side={liveSide} charge={liveConf !== null ? (liveConf - 55) / 40 : 0} pull={pullProgress} />
        )}
      </Animated.View>
    </View>
  );
}
