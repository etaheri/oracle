import { claimFirstLiveSeal, recordSealHour } from "../api/flags";
import { useState } from "react";
import { View, Pressable, StyleSheet, useWindowDimensions, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import { useQueryClient } from "@tanstack/react-query";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing, useReducedMotion, runOnJS } from "react-native-reanimated";
import { ApiError } from "../api/client";
import { useSubmit } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { cardStatus } from "../game/cardStatus";
import { useNow } from "../game/useNow";
import { capture } from "../analytics/analytics";
import { INITIAL_CHOICE, canSeal, chooseSide, type SealChoice } from "../game/sealFlow";
import { lineLabel, receiptLine, sealHint, sideLine } from "../game/stakeText";
import { colors, space } from "../theme";
import { Mono } from "./Text";
import { CardChrome, numeral } from "./CardChrome";
import { DecodeLine } from "./DecodeText";
import { odds, sidePreview, type RoundToday } from "@oracle/core";

// The throw IS the seal: take a side and the card leaves your hand -- off the
// screen edge of the side you took, one heavy thunk at dispatch. The next card
// deals in under it. If the oracle refuses, the card flies back in.
const THROW_MS = 320;
// The fraction of the card's width past which a release seals (design
// 2026-09-14 §5.2), and the floor under that distance in points -- a card
// that has not been measured yet has a width of 0, and without the floor
// every twitch would clear the bar. The same floor divides the wash, so the
// colour cannot saturate on the first pixel either. A flick faster than
// SWIPE_VELOCITY seals from anywhere.
const MIN_COMMIT_PX = 18;
const SWIPE_COMMIT = 0.35;
const SWIPE_VELOCITY = 900;

// The uncovered card's prophecy materializes IN PLACE and in ONE face: the
// exact static it wore in the stack (same seed, same serif, muted ink)
// prints left-to-right into the question's words in ink. No typeface flip,
// no reflow -- the card is an artifact whose inscription resolves, and the
// terminal lives in the symbol set and the print cadence, not the font.
// Reduced motion renders the words immediately.
export const QUESTION_FACE = { size: 22, lineHeight: 32 } as const;
const DECODE_DELAY_MS = 250;
const DECODE_MS = 600;

function QuestionFace({ text, seed }: { text: string; seed: string }) {
  return (
    <DecodeLine serif text={text} seed={seed} delayMs={DECODE_DELAY_MS} durationMs={DECODE_MS} size={QUESTION_FACE.size} color={colors.ink} dimColor={colors.mutedInk} style={{ lineHeight: QUESTION_FACE.lineHeight, textAlign: "center" }} />
  );
}

export function OracleCard({ q, roundLocksAt, fortune, onSealed, practice, height }: {
  q: RoundToday["questions"][number];
  // The round's overall lock (if any): a question whose own lock differs
  // from it closes ahead of the round, and the title says so.
  roundLocksAt: string | null;
  // The player's fortune at this moment; null on a round without stakes
  // (version 1/2, or a version 3 round that opened unstaked).
  fortune: number | null;
  // Fires when the seal ceremony completes, with the receipt the round's
  // footer prints under the next card: "YES · STAKED 50 · WINS 93".
  onSealed: (receipt: string) => void;
  practice?: { onSeal: (answer: boolean) => void; context?: string; stamp: string };
  height?: number;
}) {
  const { setAnswer, markSealed } = useRoundStore();
  const answers = useRoundStore((s) => s.answers);
  // The throw distance, read live. This was a module-scope
  // Dimensions.get("window").width, captured once at import and never
  // updated -- so after a rotation, in an iPad split view or under Stage
  // Manager the card was thrown the previous layout's width.
  const { width: screenW } = useWindowDimensions();
  const entry = practice ? undefined : answers[q.id];
  const submit = useSubmit();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [thrown, setThrown] = useState(false);
  const reducedMotion = useReducedMotion();
  const dragX = useSharedValue(0);
  const cardW = useSharedValue(0);
  const [showContext, setShowContext] = useState(false);
  const sealed = !!entry?.sealed;
  // The status field ticks at the countdown's cadence -- but ONLY while the
  // card is still open. Once it is sealed the string is the constant "ST:
  // SEALED", and a second-by-second re-render of this component repaints two
  // Skia canvases for a line that will never change again.
  const now = useNow(sealed ? null : 1000);

  const line = q.line_p_yes;
  const staked = fortune !== null && line !== null;
  const yesPreview = staked ? sidePreview({ fortune, isBigOne: q.is_big_one, line, answer: true }) : null;
  const noPreview = staked ? sidePreview({ fortune, isBigOne: q.is_big_one, line, answer: false }) : null;

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: reducedMotion ? 0 : dragX.value },
      { rotate: `${reducedMotion ? 0 : (dragX.value / Math.max(1, cardW.value)) * 8}deg` },
    ],
  }));
  // The side washes: the side the finger is heading for bleeds in behind the
  // question, tracking the drag as a fraction of the commit distance, so the
  // colour is full at exactly the point a release will seal.
  const yesWashStyle = useAnimatedStyle(() => ({ opacity: dragX.value > 0 ? Math.min(1, dragX.value / Math.max(MIN_COMMIT_PX, cardW.value * SWIPE_COMMIT)) : 0 }));
  const noWashStyle = useAnimatedStyle(() => ({ opacity: dragX.value < 0 ? Math.min(1, -dragX.value / Math.max(MIN_COMMIT_PX, cardW.value * SWIPE_COMMIT)) : 0 }));

  // The round advances only after the throw: the store's sealed flag is the
  // thing that swaps `current`, so it must not flip mid-flight.
  // `serverStake` is what the house actually took, and it is the truth: the
  // local preview was priced against the fortune this screen was rendered
  // with, which an earlier round settling mid-window can have moved. Prefer
  // it, and re-price the winnings at the same line the preview used. The
  // local preview stays the fallback -- an unstaked (lineless) round has no
  // server stake to prefer.
  function finishSeal(answer: boolean, serverStake: number | null) {
    markSealed(q.id, serverStake);
    const preview = answer ? yesPreview : noPreview;
    const stake = serverStake ?? preview?.stake ?? null;
    const wins = serverStake !== null && line !== null ? Math.round(serverStake * odds(answer, line)) : preview?.wins ?? null;
    capture("question_answered", { question_id: q.id, is_big_one: q.is_big_one, side: answer ? "yes" : "no", stake, line });
    // Habitual-hour history (design 2026-09-09 §4.2): fire-and-forget --
    // withSealHour already no-ops repeat seals on the same local day.
    void recordSealHour(new Date());
    onSealed(receiptLine({ answer, stake, wins }));
  }

  // The swipe IS the seal (design H2): the moment the side is set the card is
  // dispatched -- one heavy thunk, off the chosen edge -- while the server
  // call flies with it. On refusal the card flies back in, unsealed, sealable
  // again.
  async function seal(answer: boolean) {
    if (sealed || thrown || submit.isPending) {
      // A pan that cleared the bar left the card leaning, and this refusal
      // means nothing will throw it -- put it back rather than strand it
      // mid-lean. Not while `thrown`: a throw already owns dragX and is
      // carrying the card off-screen, and springing here would yank it back.
      if (!thrown && !reducedMotion) dragX.value = withSpring(0, { damping: 18, stiffness: 220 });
      return;
    }
    const choice: SealChoice = chooseSide(INITIAL_CHOICE, answer);
    if (!canSeal(choice)) return;
    setError(null);
    if (!practice) setAnswer(q.id, answer);
    const key = practice ? null : useRoundStore.getState().answers[q.id]!.idempotencyKey;
    let flight: Promise<void> = Promise.resolve();
    if (!reducedMotion) {
      setThrown(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      flight = new Promise<void>((resolve) => {
        dragX.value = withTiming((answer ? 1 : -1) * screenW * 1.2, { duration: THROW_MS, easing: Easing.in(Easing.poly(3)) }, () => { runOnJS(resolve)(); });
      });
    }
    // Practice shares the entire interaction and throw, but exits before
    // submission, live flags, analytics, or persisted round-state writes.
    if (practice) {
      await flight;
      practice.onSeal(answer);
      return;
    }
    try {
      const res = await submit.mutateAsync({ question_id: q.id, answer, idempotency_key: key! });
      if (await claimFirstLiveSeal()) capture("first_live_seal", { stake: res.stake });
      await flight;
      if (reducedMotion) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finishSeal(answer, res.stake);
    } catch (e) {
      // Let the throw land before the card returns -- a mid-air reversal
      // reads as a glitch, a full return reads as the oracle's refusal.
      await flight;
      setThrown(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (!reducedMotion) dragX.value = withSpring(0, { damping: 16, stiffness: 160 });
      setError(e instanceof ApiError && e.status === 409 ? "THE ORACLE HAS CLOSED" : "THE CONNECTION WAVERS — TRY AGAIN");
      // A 409 means this question closed under us -- a stale `today` would
      // keep dealing it. Refetch so the round advances past the dead card.
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: ["round", "today"] });
    }
  }

  const busy = sealed || thrown || submit.isPending;

  // A horizontal pan on the card. The lean and wash follow the finger; a
  // release past the commit fraction (or a fast flick) seals, anything short
  // springs back to centre. Vertical scroll inside the card stays with the
  // ScrollView: activeOffsetX hands the gesture over only once it is clearly
  // sideways, failOffsetY gives it up once it is clearly vertical.
  const pan = Gesture.Pan()
    .enabled(!busy && !reducedMotion)
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onUpdate((e) => { dragX.value = e.translationX; })
    // `success` is false when the pan was cancelled or failed rather than
    // finished by the player -- the OS edge-swipe stealing the touch, the app
    // backgrounding, another handler winning, or `.enabled` flipping false
    // mid-drag. Every one of those fires onEnd too, and a seal is
    // irreversible, so a release is the only thing allowed to place the bet.
    // Same reading of the second argument as the orb's onFinalize.
    .onEnd((e, success) => {
      const commit = Math.max(MIN_COMMIT_PX, cardW.value * SWIPE_COMMIT);
      const past = Math.abs(e.translationX) >= commit || Math.abs(e.velocityX) >= SWIPE_VELOCITY;
      if (past && success) {
        const answer = (Math.abs(e.translationX) >= commit ? e.translationX : e.velocityX) > 0;
        runOnJS(seal)(answer);
      } else {
        dragX.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  // Slot and provenance only. The day used to ride here too, but source_name
  // is unbounded and the card's margin is now one shared row with the live
  // status field -- so something had to give, and the date is the redundant
  // half: the round's own TopBar prints DAY <date> a few inches above this.
  const coordinate = `:: ${numeral(q.slot)} / PER ${q.source_name.toUpperCase()}`;
  const closesEarly = roundLocksAt !== null && q.locks_at !== roundLocksAt;
  const title = q.is_big_one ? "✶ THE BIG ONE" : q.category;
  const modifiers = [q.is_big_one ? "STAKES DOUBLE" : null, closesEarly ? "CLOSES EARLY" : null].filter(Boolean).join(" · ");
  const lineText = lineLabel(line);

  return (
    <View>
      <GestureDetector gesture={pan}>
        <Animated.View style={frontStyle} onLayout={(e) => { cardW.value = e.nativeEvent.layout.width; }}>
          <CardChrome height={height} slot={q.slot} title={title} modifiers={modifiers || undefined} big={q.is_big_one} coordinate={coordinate}
            status={practice ? practice.stamp : cardStatus(q.locks_at, now, sealed)}>
            <View style={{ flex: 1, minHeight: 0 }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space(2) }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
                <QuestionFace text={q.text} seed={q.id} />
                {/* The house posts its line before the seal (design D2). */}
                {lineText && <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{lineText}</Mono>}
                {practice?.context && <Mono size={11} style={{ textAlign: "center" }}>{practice.context}</Mono>}
                {q.context && <View style={{ gap: space(1) }}>
                  <Pressable accessibilityRole="button" onPress={() => setShowContext(!showContext)} style={{ minHeight: 44, justifyContent: "center" }}><Mono size={11}>{showContext ? "CLOSE CONTEXT" : "CONTEXT"}</Mono></Pressable>
                  {showContext && <><Mono size={11}>{q.context.text}</Mono><Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(q.context!.sourceUrl); }} style={{ minHeight: 44 }}><Mono size={10}>SOURCE · AS OF {new Date(q.context.asOf).toLocaleString()}</Mono></Pressable></>}
                </View>}
              </ScrollView>
            </View>
            <View style={{ gap: space(3) }}>
              {/* The side is the seal: tapping YES or NO throws the card the
                  same way a swipe does. Sleeve semantics from the art: YES
                  wears the ultramarine sleeve, NO the vermilion. */}
              <View style={{ flexDirection: "row", gap: space(2) }}>
                {([true, false] as const).map((v) => {
                  const tone = v ? colors.ultramarine : colors.vermilion;
                  const preview = v ? yesPreview : noPreview;
                  return (
                    <Pressable key={String(v)} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { void seal(v); }}
                      accessibilityLabel={preview ? `${v ? "Yes" : "No"}, stake ${preview.stake}, wins ${preview.wins}` : v ? "Yes" : "No"}
                      accessibilityHint="Seals your call."
                      style={{ flex: 1, borderWidth: 1, borderColor: tone, minHeight: 48, justifyContent: "center", alignItems: "center", gap: 2 }}>
                      <Mono size={12} color={tone} letterSpacing={5} style={{ marginRight: -5 }}>{v ? "YES" : "NO"}</Mono>
                      {preview && <Mono size={9} color={colors.mutedInk} letterSpacing={1}>{sideLine(v, preview.stake, preview.wins, q.is_big_one)}</Mono>}
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ minHeight: 16, justifyContent: "center" }}>
                {error
                  ? <Mono size={11} color={colors.vermilion} style={{ textAlign: "center" }}>{error}</Mono>
                  : <DecodeLine text={submit.isPending ? "SEALING…" : sealHint(reducedMotion)} size={11} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }} />}
              </View>
            </View>
          </CardChrome>
          {/* Plain-View wrapper carries pointerEvents="none": an opacity-0 view
              still hit-tests, and reanimated does not reliably forward the
              pointerEvents PROP -- a none-wrapper makes the washes untouchable. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.ultramarineWash }, yesWashStyle]} />
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.vermilionWash }, noWashStyle]} />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
