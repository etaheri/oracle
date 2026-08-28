import { useEffect, useRef, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, useDerivedValue, withTiming, withSpring, withSequence, withDelay, Easing, useReducedMotion, runOnJS } from "react-native-reanimated";
import { leanRelease, leanStep, holdConfidence, LEAN_COMMIT, LEAN_DEAD_ZONE } from "../game/swipeLean";
import { decodeFrame } from "../game/terminalPrint";
import { useScreenReader } from "../hooks/useScreenReader";
import { getSwipeHinted, markSwipeHinted } from "../api/flags";
import { ApiError } from "../api/client";
import { useSubmit } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { colors, space } from "../theme";
import { Serif, Mono } from "./Text";
import { GoldButton } from "./Button";
import { ConvictionMeter } from "./ConvictionMeter";
import { CardChrome, numeral } from "./CardChrome";
import { SealStamp, STAMP_MS } from "./SealStamp";
import { CrowdBar } from "./CrowdReveal";
import { AsciiActivation } from "./TerminalPatina";
import { DecodeLine } from "./DecodeText";
import type { RoundToday } from "@oracle/core";

export interface CrowdEntry { crowd_yes_pct: number; player_count: number }

const FLIP_MS = 650;

// The dealt card's prophecy materializes: the mono static it wore in the
// deck dissolves into the serif question. Reduced motion renders the serif
// immediately.
function QuestionFace({ text }: { text: string }) {
  const reducedMotion = useReducedMotion();
  const t = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (!reducedMotion) t.value = withDelay(320, withTiming(1, { duration: 480 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design
  }, []);
  const serifStyle = useAnimatedStyle(() => ({ opacity: t.value }));
  const noiseStyle = useAnimatedStyle(() => ({ opacity: 1 - t.value }));
  return (
    <View>
      <Animated.View style={serifStyle}>
        <Serif size={22} style={{ lineHeight: 32, textAlign: "center" }}>{text}</Serif>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: "center", pointerEvents: "none" }, noiseStyle]}>
        <Mono size={13} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center", lineHeight: 24 }}>
          {decodeFrame(text, 0, 1, text)}
        </Mono>
      </Animated.View>
    </View>
  );
}

export function OracleCard({ q, date, revealed, crowd, isLast, onSealed, onNext, onLean }: {
  q: RoundToday["questions"][number];
  date: string;
  revealed: boolean;
  crowd: CrowdEntry | undefined;
  isLast: boolean;
  onSealed: () => void;
  onNext: () => void;
  // The screen renders the stationary conviction column; the card reports
  // its live lean upward (null conf = no pull in progress).
  onLean?: (conf: number | null, side: boolean) => void;
}) {
  const { answers, setAnswer, setConfidence, markSealed } = useRoundStore();
  const entry = answers[q.id];
  const submit = useSubmit();
  const [error, setError] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);
  const [cardSize, setCardSize] = useState({ w: 0, h: 0 });
  const reducedMotion = useReducedMotion();
  const flip = useSharedValue(revealed ? 180 : 0);
  // Swipe-to-lean: dragging the card face tilts it toward a side; release
  // past the commit threshold selects (never seals). dragX/cardW live on the
  // UI thread; the release decision runs the node-tested game module on JS.
  const dragX = useSharedValue(0);
  const cardW = useSharedValue(0);
  const stepSV = useSharedValue(-1);
  const pullProgress = useDerivedValue(() => (cardW.value > 0 ? dragX.value / cardW.value : 0));
  // The conviction the current pull (or button hold) implies — drives the
  // conviction meter and the ratchet haptics.
  const [liveConf, setLiveConf] = useState<number | null>(null);
  const [liveSide, setLiveSide] = useState(true);
  useEffect(() => { onLean?.(liveConf, liveSide); }, [liveConf, liveSide, onLean]);
  const screenReader = useScreenReader();
  // The accessible twin: screen-reader and reduced-motion players get the
  // hold-to-charge buttons instead of the drag.
  const buttonsMode = screenReader || reducedMotion;

  useEffect(() => {
    if (reducedMotion) { flip.value = revealed ? 180 : 0; return; }
    flip.value = withTiming(revealed ? 180 : 0, { duration: FLIP_MS, easing: Easing.out(Easing.poly(4)) });
  }, [revealed, reducedMotion, flip]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${flip.value}deg` },
      { translateX: reducedMotion ? 0 : dragX.value },
      { rotate: `${reducedMotion ? 0 : (dragX.value / Math.max(1, cardW.value)) * 8}deg` },
    ],
    backfaceVisibility: "hidden" as const,
  }));
  // The side washes bleed in with the lean — same tokens as the selected
  // button state, so the gesture and the buttons speak one color language.
  const yesWashStyle = useAnimatedStyle(() => {
    const p = dragX.value / Math.max(1, cardW.value);
    return { opacity: p > LEAN_DEAD_ZONE ? Math.min(1, p / LEAN_COMMIT) : 0 };
  });
  const noWashStyle = useAnimatedStyle(() => {
    const p = -dragX.value / Math.max(1, cardW.value);
    return { opacity: p > LEAN_DEAD_ZONE ? Math.min(1, p / LEAN_COMMIT) : 0 };
  });
  // The question recedes as conviction takes the stage — fully by the
  // commit point during a pull, and while a hold-to-charge is live.
  const holdDim = liveConf !== null;
  const questionStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(dragX.value) / Math.max(1, cardW.value * LEAN_COMMIT));
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
  function onStepChange(step: number, prev: number, side: boolean) {
    if (step === -1) { setLiveConf(null); return; }
    setLiveSide(side);
    setLiveConf(55 + step * 5);
    if (prev === -1) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else void Haptics.selectionAsync();
  }

  const sealed = !!entry?.sealed;
  const pan = Gesture.Pan()
    .enabled(!revealed && !stamped && !sealed && !submit.isPending)
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onUpdate((e) => {
      dragX.value = e.translationX;
      const step = leanStep(e.translationX, cardW.value);
      if (step !== stepSV.value) {
        const prev = stepSV.value;
        stepSV.value = step;
        runOnJS(onStepChange)(step, prev, e.translationX > 0);
      }
    })
    .onEnd((e) => {
      runOnJS(commitLean)(e.translationX, cardW.value);
      stepSV.value = -1;
      if (reducedMotion) dragX.value = 0;
      else dragX.value = withSpring(0, { damping: 18, stiffness: 220 });
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
          void Haptics.selectionAsync();
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
    if (buttonsMode || entry) return;
    let cancelled = false;
    void getSwipeHinted().then((seen) => {
      if (seen || cancelled) return;
      void markSwipeHinted();
      dragX.value = withDelay(900, withSequence(withTiming(18, { duration: 320 }), withTiming(0, { duration: 420, easing: Easing.out(Easing.poly(3)) })));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design
  }, []);
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${flip.value + 180}deg` }],
    backfaceVisibility: "hidden" as const,
  }));

  // Release IS the seal: the pull (or hold) hands its side + conviction
  // straight here. The meter stays lit while the seal is in flight; on
  // failure the card returns unsealed with the error line, pullable again.
  async function sealWith(answer: boolean, confidence: number) {
    setError(null);
    setAnswer(q.id, answer);
    setConfidence(q.id, confidence);
    const key = useRoundStore.getState().answers[q.id]!.idempotencyKey;
    try {
      await submit.mutateAsync({ question_id: q.id, answer, confidence, idempotency_key: key });
      markSealed(q.id);
      setLiveConf(null);
      if (reducedMotion) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onSealed();
        return;
      }
      // Stamp lands, heavy haptic at its settle, then the flip.
      setStamped(true);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), STAMP_MS);
      setTimeout(onSealed, STAMP_MS + 320);
    } catch (e) {
      setLiveConf(null);
      setError(e instanceof ApiError && e.status === 409 ? "THE ORACLE HAS CLOSED" : "THE CONNECTION WAVERS — TRY AGAIN");
    }
  }

  const title = q.is_big_one ? "✶ The Big One · worth double" : q.category;
  const mySidePct = crowd && entry ? (entry.answer ? crowd.crowd_yes_pct : 100 - crowd.crowd_yes_pct) : null;

  return (
    <View>
      <Animated.View
        style={frontStyle}
        onLayout={(e) => {
          setCardSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
          cardW.value = e.nativeEvent.layout.width;
        }}
      >
        <CardChrome slot={q.slot} title={title} big={q.is_big_one} coordinate={`:: ${numeral(q.slot)} / ${date} / PER ${q.source_name.toUpperCase()}`}>
          {/* The question floats centered in the card's field, tarot-fashion;
              the controls anchor at the foot. The face is also the grab
              surface: swipe it to lean toward a side (buttons remain the
              canonical path — the gesture only ever selects, never seals). */}
          <GestureDetector gesture={pan}>
            <Animated.View style={[{ flex: 1, justifyContent: "center" }, questionStyle]}>
              <QuestionFace text={q.text} />
            </Animated.View>
          </GestureDetector>
          <View style={{ gap: space(3) }}>
            {liveConf === null && !buttonsMode && !sealed ? (
              <DecodeLine text="‹ NO ─ PULL · RELEASE ─ YES ›" size={11} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }} />
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
                      accessibilityHint="Hold to raise conviction; releasing seals the prophecy."
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
        {liveConf !== null && <ConvictionMeter conf={liveConf} side={liveSide} pull={pullProgress} />}
        {stamped && <AsciiActivation width={cardSize.w} height={cardSize.h} />}
        {stamped && <SealStamp numeral={numeral(q.slot)} />}
      </Animated.View>
      {/* The turned-away face must not hit-test: RN hit-testing ignores
          backfaceVisibility, so the hidden back face — rendered above the
          front — would swallow every touch on the card. style.pointerEvents
          (not the prop) so reanimated can't drop it. */}
      <Animated.View style={[StyleSheet.absoluteFill, backStyle, { pointerEvents: revealed ? "auto" : "none" }]}>
        <CardChrome slot={q.slot} title="The crowd speaks" big={q.is_big_one} fill coordinate=":: THE LEDGER IS READ TOMORROW NOON">
          <View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
            <Serif size={17} color={colors.mutedInk} numberOfLines={2}>{q.text}</Serif>
            {crowd && entry ? (
              <>
                <CrowdBar pct={crowd.crowd_yes_pct} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Mono size={10} color={colors.goldText}>{crowd.crowd_yes_pct}% SAY YES</Mono>
                  <Mono size={10} color={mySidePct !== null && mySidePct < 40 ? colors.goldText : colors.mutedInk}>
                    {entry.answer ? "YOU: YES" : "YOU: NO"} @ {entry.confidence}%{mySidePct !== null && mySidePct < 40 ? " · AGAINST THE TIDE" : ""}
                  </Mono>
                </View>
                <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>
                  {crowd.player_count} ORACLES CONSULTED
                </Mono>
              </>
            ) : (
              <DecodeLine text="CONSULTING THE CROWD…" cursor size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2} />
            )}
          </View>
          <GoldButton title={isLast ? "BEHOLD THE SPREAD" : "DRAW THE NEXT CARD"} onPress={onNext} />
        </CardChrome>
      </Animated.View>
    </View>
  );
}
