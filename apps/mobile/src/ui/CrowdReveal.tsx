import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { colors, space } from "../theme";
import { Serif, Mono, Eyebrow } from "./Text";
import { useCrowdSoFar } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import type { RoundToday } from "@oracle/core";

function Bar({ pct }: { pct: number }) {
  const w = useSharedValue(0);
  useEffect(() => { w.value = withTiming(pct, { duration: 900 }); }, [pct, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return (
    <View style={{ height: 3, backgroundColor: colors.lineSoft }}>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.gold }, style]} />
    </View>
  );
}

export function CrowdReveal({ round }: { round: RoundToday }) {
  const crowd = useCrowdSoFar(true);
  const answers = useRoundStore((s) => s.answers);
  const byId = new Map((crowd.data?.questions ?? []).map((c) => [c.id, c]));
  const sealed = round.questions.filter((q) => answers[q.id]?.sealed && byId.has(q.id));
  const playerCount = Math.max(0, ...sealed.map((q) => byId.get(q.id)!.player_count));

  return (
    <View style={{ flex: 1, gap: space(4) }}>
      <Eyebrow>The crowd is revealed</Eyebrow>
      <View style={{ gap: space(4), flex: 1 }}>
        {sealed.map((q) => {
          const c = byId.get(q.id)!;
          const mine = answers[q.id]!;
          const mySidePct = mine.answer ? c.crowd_yes_pct : 100 - c.crowd_yes_pct;
          return (
            <View key={q.id} style={{ gap: space(1.5) }}>
              <Serif size={15} color={colors.boneDim} numberOfLines={1}>{q.text}</Serif>
              <Bar pct={c.crowd_yes_pct} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Mono size={10} color={colors.gold}>{c.crowd_yes_pct}% SAY YES</Mono>
                <Mono size={10} color={mySidePct < 40 ? colors.goldBright : colors.ash}>
                  {mine.answer ? "YOU: YES" : "YOU: NO"} @ {mine.confidence}%{mySidePct < 40 ? " · AGAINST THE TIDE" : ""}
                </Mono>
              </View>
            </View>
          );
        })}
      </View>
      <Mono size={11} color={colors.gold} style={{ textAlign: "center" }} letterSpacing={2}>
        {playerCount} ORACLES CONSULTED
      </Mono>
      <Mono size={10} color={colors.ash} style={{ textAlign: "center" }}>
        The ledger is read tomorrow at noon.
      </Mono>
    </View>
  );
}
