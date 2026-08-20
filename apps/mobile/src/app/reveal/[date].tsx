import { View, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "../../ui/Screen";
import { Serif, Mono, Eyebrow } from "../../ui/Text";
import { useReveal } from "../../api/hooks";
import { colors, space } from "../../theme";

export default function RevealScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const reveal = useReveal(date ?? null);

  if (reveal.isLoading) return <Screen><Eyebrow>Consulting the void…</Eyebrow></Screen>;
  if (!reveal.data || "pending" in reveal.data) {
    return <Screen><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <Eyebrow>{`Day ${date ?? ""}`}</Eyebrow>
      <Serif size={22} style={{ textAlign: "center" }}>The ledger is not yet read.</Serif>
      <Mono size={11} color={colors.ash} style={{ textAlign: "center" }}>Return at noon.</Mono>
    </View></Screen>;
  }

  const d = reveal.data;
  const big = d.questions.find((q) => q.slot === 5);
  const pos = d.day_points >= 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space(4), paddingBottom: space(6) }}>
        <Eyebrow>{`Day ${d.date} · the ledger is read`}</Eyebrow>
        <View style={{ alignItems: "center", gap: space(1) }}>
          <Serif size={54} color={pos ? colors.goldBright : colors.oxblood}>{pos ? `+${d.day_points}` : String(d.day_points)}</Serif>
          <Mono size={9} color={colors.ash} letterSpacing={5}>DAY POINTS</Mono>
        </View>
        <View>
          {d.questions.filter((q) => q.slot !== 5).map((q) => {
            const won = q.my && q.outcome !== "void" && q.my.points !== null && q.my.points > 0;
            const mark = q.outcome === "void" ? "∅" : won ? "✓" : q.my ? "✗" : "·";
            const color = q.outcome === "void" ? colors.ash : won ? colors.gold : q.my ? colors.oxblood : colors.ash;
            return (
              <View key={q.id} style={{ flexDirection: "row", gap: space(2), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.lineSoft, alignItems: "baseline" }}>
                <Mono size={12} color={color}>{mark}</Mono>
                <Mono size={11} color={colors.boneDim} style={{ flex: 1 }} numberOfLines={1}>{q.text}</Mono>
                <Mono size={12} color={color}>{q.my?.points != null ? (q.my.points > 0 ? `+${q.my.points}` : String(q.my.points)) : "—"}</Mono>
              </View>
            );
          })}
        </View>
        {big && (
          <View style={{ borderWidth: 1, borderColor: colors.gold, padding: space(3), gap: space(2), backgroundColor: colors.goldWash }}>
            <Mono size={9} color={colors.gold} letterSpacing={4}>✶ THE BIG ONE</Mono>
            <Serif size={17}>{big.text}</Serif>
            {big.my && big.crowd_yes_pct !== null && (() => {
              const sidePct = big.my.answer ? big.crowd_yes_pct : 100 - big.crowd_yes_pct;
              const contrarianWin = sidePct < 40 && (big.my.points ?? 0) > 0;
              return (
                <View style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Mono size={11}>YOU: {big.my.answer ? "YES" : "NO"} @ {big.my.confidence}%</Mono>
                    <Mono size={11} color={(big.my.points ?? 0) >= 0 ? colors.goldBright : colors.oxblood}>
                      {(big.my.points ?? 0) > 0 ? `+${big.my.points}` : String(big.my.points ?? "—")}
                    </Mono>
                  </View>
                  <Mono size={10} color={colors.ash}>CROWD SAID {big.crowd_yes_pct}% YES{contrarianWin ? " · AGAINST THE TIDE ×2" : ""}</Mono>
                </View>
              );
            })()}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
