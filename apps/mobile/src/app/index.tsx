import { View } from "react-native";
import { Screen } from "../ui/Screen";
import { Serif, Mono, Eyebrow } from "../ui/Text";
import { GoldButton } from "../ui/Button";
import { useToday } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { colors, space } from "../theme";
import { useRouter } from "expo-router";

const QUOTE = `"It's tough to make predictions,\nespecially about the future."`;

function yesterdayOf(date: string | undefined): string {
  const base = date ? new Date(`${date}T00:00:00Z`) : new Date();
  return new Date(base.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export default function Index() {
  const today = useToday();
  const answers = useRoundStore((s) => s.answers);
  const router = useRouter();

  const round = today.data;
  const allSealed = !!round && round.questions.length > 0 && round.questions.every((q) => answers[q.id]?.sealed);
  const yesterday = yesterdayOf(round?.date);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(5) }}>
        <Eyebrow>Oracle OS v1.0</Eyebrow>
        <Serif size={44} style={{ letterSpacing: 12 }}>ORACLE</Serif>
        <Mono size={12} color={colors.boneDim} style={{ textAlign: "center", lineHeight: 20 }}>{QUOTE}</Mono>
        <Mono size={10} color={colors.gold} letterSpacing={3}>— YOGI BERRA</Mono>
        <View style={{ width: "100%", gap: space(3), paddingTop: space(4) }}>
          {round && !allSealed && (
            <>
              <Mono size={11} color={colors.gold} style={{ textAlign: "center" }} letterSpacing={2}>
                {round.player_count > 0 ? `${round.player_count} ORACLES ALREADY WAITING` : "THE ORACLE SPEAKS"}
              </Mono>
              <GoldButton title="ENTER" onPress={() => router.push("/round")} />
            </>
          )}
          {round && allSealed && (
            <>
              <Mono size={11} color={colors.gold} style={{ textAlign: "center" }} letterSpacing={2}>THE PROPHECY IS SEALED</Mono>
              <GoldButton title="BEHOLD THE CROWD" onPress={() => router.push("/round")} />
              <Mono size={10} color={colors.gold} style={{ textAlign: "center" }} letterSpacing={2}>THE LEDGER IS READ AT NOON</Mono>
            </>
          )}
          {!round && !today.isLoading && (
            <Mono size={11} color={colors.ash} style={{ textAlign: "center" }} letterSpacing={2}>THE ORACLE SLEEPS</Mono>
          )}
          <GoldButton title="YESTERDAY'S LEDGER" onPress={() => router.push(`/reveal/${yesterday}`)} />
        </View>
      </View>
    </Screen>
  );
}
