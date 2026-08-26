import { useEffect, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion } from "react-native-reanimated";
import { ApiError } from "../api/client";
import { useSubmit } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { colors, space } from "../theme";
import { Serif, Mono } from "./Text";
import { GoldButton } from "./Button";
import { ConfidenceSlider } from "./ConfidenceSlider";
import { CardChrome } from "./CardChrome";
import { CrowdBar } from "./CrowdReveal";
import type { RoundToday } from "@oracle/core";

export interface CrowdEntry { crowd_yes_pct: number; player_count: number }

const FLIP_MS = 650;

export function OracleCard({ q, revealed, crowd, isLast, onSealed, onNext }: {
  q: RoundToday["questions"][number];
  revealed: boolean;
  crowd: CrowdEntry | undefined;
  isLast: boolean;
  onSealed: () => void;
  onNext: () => void;
}) {
  const { answers, setAnswer, setConfidence, markSealed } = useRoundStore();
  const entry = answers[q.id];
  const submit = useSubmit();
  const [error, setError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const flip = useSharedValue(revealed ? 180 : 0);

  useEffect(() => {
    if (reducedMotion) { flip.value = revealed ? 180 : 0; return; }
    flip.value = withTiming(revealed ? 180 : 0, { duration: FLIP_MS, easing: Easing.out(Easing.poly(4)) });
  }, [revealed, reducedMotion, flip]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${flip.value}deg` }],
    backfaceVisibility: "hidden" as const,
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${flip.value + 180}deg` }],
    backfaceVisibility: "hidden" as const,
  }));

  async function seal() {
    if (!entry) return;
    setError(null);
    try {
      await submit.mutateAsync({ question_id: q.id, answer: entry.answer, confidence: entry.confidence, idempotency_key: entry.idempotencyKey });
      markSealed(q.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSealed();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "THE ORACLE HAS CLOSED" : "THE CONNECTION WAVERS — TRY AGAIN");
    }
  }

  const title = q.is_big_one ? "✶ The Big One · worth double" : q.category;
  const mySidePct = crowd && entry ? (entry.answer ? crowd.crowd_yes_pct : 100 - crowd.crowd_yes_pct) : null;

  return (
    <View>
      <Animated.View style={frontStyle}>
        <CardChrome slot={q.slot} title={title} big={q.is_big_one} caption={`resolves per ${q.source_name}`.toUpperCase()}>
          <Serif size={22} style={{ lineHeight: 30 }}>{q.text}</Serif>
          <View style={{ flexDirection: "row", gap: space(2) }}>
            {([true, false] as const).map((v) => {
              const sel = entry?.answer === v;
              // Sleeve semantics from the art: YES wears the lapis sleeve, NO the oxblood.
              const tone = v ? colors.lapis : colors.oxblood;
              const wash = v ? colors.lapisWash : colors.oxbloodWash;
              return (
                <Pressable key={String(v)} accessibilityRole="button" accessibilityState={{ selected: sel }} onPress={() => setAnswer(q.id, v)}
                  style={{ flex: 1, borderWidth: 1, borderColor: sel ? tone : colors.line, minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: sel ? wash : "transparent" }}>
                  <Mono size={12} color={sel ? tone : colors.inkDim} letterSpacing={5} style={{ marginRight: -5 }}>{v ? "YES" : "NO"}</Mono>
                </Pressable>
              );
            })}
          </View>
          {entry && <ConfidenceSlider value={entry.confidence} onChange={(c) => setConfidence(q.id, c)} />}
          {error && <Mono size={11} color={colors.oxblood} style={{ textAlign: "center" }}>{error}</Mono>}
          <GoldButton title={submit.isPending ? "SEALING…" : "SEAL THE PROPHECY"} onPress={seal} disabled={!entry || submit.isPending} />
        </CardChrome>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, backStyle]}>
        <CardChrome slot={q.slot} title="The crowd speaks" big={q.is_big_one} fill caption="THE LEDGER IS READ TOMORROW AT NOON">
          <View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
            <Serif size={17} color={colors.inkDim} numberOfLines={2}>{q.text}</Serif>
            {crowd && entry ? (
              <>
                <CrowdBar pct={crowd.crowd_yes_pct} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Mono size={10} color={colors.goldDeep}>{crowd.crowd_yes_pct}% SAY YES</Mono>
                  <Mono size={10} color={mySidePct !== null && mySidePct < 40 ? colors.goldDeep : colors.umber}>
                    {entry.answer ? "YOU: YES" : "YOU: NO"} @ {entry.confidence}%{mySidePct !== null && mySidePct < 40 ? " · AGAINST THE TIDE" : ""}
                  </Mono>
                </View>
                <Mono size={10} color={colors.umber} style={{ textAlign: "center" }} letterSpacing={2}>
                  {crowd.player_count} ORACLES CONSULTED
                </Mono>
              </>
            ) : (
              <Mono size={11} color={colors.umber} style={{ textAlign: "center" }} letterSpacing={2}>CONSULTING THE CROWD…</Mono>
            )}
          </View>
          <GoldButton title={isLast ? "BEHOLD THE SPREAD" : "DRAW THE NEXT CARD"} onPress={onNext} />
        </CardChrome>
      </Animated.View>
    </View>
  );
}
