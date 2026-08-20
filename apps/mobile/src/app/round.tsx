import { useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Screen } from "../ui/Screen";
import { Serif, Mono, Eyebrow } from "../ui/Text";
import { QuestionCard } from "../ui/QuestionCard";
import { CrowdReveal } from "../ui/CrowdReveal";
import { useToday } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { colors, space } from "../theme";

export default function Round() {
  const today = useToday();
  const answers = useRoundStore((s) => s.answers);
  const [, force] = useState(0);

  if (today.isLoading) return <Screen><ActivityIndicator color={colors.gold} /></Screen>;
  if (!today.data) return <Screen><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}><Eyebrow>The oracle sleeps</Eyebrow><Serif size={20}>No round is open.</Serif></View></Screen>;

  const qs = [...today.data.questions].sort((a, b) => a.slot - b.slot);
  const current = qs.find((q) => !answers[q.id]?.sealed);

  return (
    <Screen>
      <Eyebrow>{`Oracle OS v1.0 · Day ${today.data.date}`}</Eyebrow>
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        {current ? <QuestionCard q={current} onSealed={() => force((n) => n + 1)} /> : <CrowdReveal round={today.data} />}
      </View>
      <View style={{ flexDirection: "row", gap: space(1.5), justifyContent: "center", paddingTop: space(2) }}>
        {qs.map((q) => (
          <View key={q.id} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: answers[q.id]?.sealed ? colors.gold : colors.line }} />
        ))}
      </View>
      <Mono size={9} color={colors.ash} style={{ textAlign: "center", paddingTop: space(2) }}>
        The crowd's leaning is hidden until you commit.
      </Mono>
    </Screen>
  );
}
