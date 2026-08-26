import { useState } from "react";
import { View, ActivityIndicator } from "react-native";
import Animated, { Easing, FadeIn, Keyframe, useReducedMotion } from "react-native-reanimated";
import { Screen } from "../ui/Screen";
import { Serif, Mono, Ritual, Eyebrow } from "../ui/Text";
import { TopBar } from "../ui/TopBar";
import { OracleCard } from "../ui/OracleCard";
import { CrowdReveal } from "../ui/CrowdReveal";
import { numeral } from "../ui/CardChrome";
import { useToday, useCrowdSoFar } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { colors, space } from "../theme";

// Cards come off a deck: up from the bottom edge, slightly rotated, settling
// with the house easing. Reduced motion gets a plain 200ms fade.
const DealIn = new Keyframe({
  0: { transform: [{ translateY: 560 }, { rotate: "-5deg" }], opacity: 0.9 },
  100: { transform: [{ translateY: 0 }, { rotate: "0deg" }], opacity: 1, easing: Easing.out(Easing.poly(4)) },
}).duration(480);

export default function Round() {
  const today = useToday();
  const reducedMotion = useReducedMotion();
  const answers = useRoundStore((s) => s.answers);
  const [revealedId, setRevealedId] = useState<string | null>(null);

  const qs = [...(today.data?.questions ?? [])].sort((a, b) => a.slot - b.slot);
  const anySealed = qs.some((q) => answers[q.id]?.sealed);
  const crowd = useCrowdSoFar(anySealed);

  if (today.isLoading) return <Screen><TopBar /><ActivityIndicator color={colors.agedGold} /></Screen>;
  if (!today.data) return <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}><Eyebrow>The oracle sleeps</Eyebrow><Serif size={20}>No round is open.</Serif></View></Screen>;

  const crowdById = new Map((crowd.data?.questions ?? []).map((c) => [c.id, c]));
  const revealedQ = revealedId ? qs.find((q) => q.id === revealedId) : undefined;
  const current = revealedQ ?? qs.find((q) => !answers[q.id]?.sealed);
  const allSealed = qs.length > 0 && qs.every((q) => answers[q.id]?.sealed);

  return (
    <Screen>
      <TopBar label={`DAY ${today.data.date}`} />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        {current ? (
          <Animated.View key={current.id} entering={reducedMotion ? FadeIn.duration(200) : DealIn}>
            <OracleCard
              q={current}
              revealed={revealedQ?.id === current.id}
              crowd={crowdById.get(current.id)}
              isLast={allSealed}
              onSealed={() => setRevealedId(current.id)}
              onNext={() => setRevealedId(null)}
            />
          </Animated.View>
        ) : (
          <CrowdReveal round={today.data} />
        )}
      </View>
      <View style={{ flexDirection: "row", gap: space(4), justifyContent: "center", paddingTop: space(2) }}>
        {qs.map((q) => (
          <Ritual key={q.id} size={12} color={answers[q.id]?.sealed ? colors.goldText : "rgba(23,25,31,0.22)"} letterSpacing={1}>
            {numeral(q.slot)}
          </Ritual>
        ))}
      </View>
      <Mono size={9} color={colors.mutedInk} style={{ textAlign: "center", paddingTop: space(2) }}>
        The crowd's leaning is hidden until you commit.
      </Mono>
    </Screen>
  );
}
