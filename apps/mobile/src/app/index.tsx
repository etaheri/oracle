import { View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Screen } from "../ui/Screen";
import { Serif, Mono, Ritual, Eyebrow } from "../ui/Text";
import { GoldButton, QuietLink } from "../ui/Button";
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
  const { width } = useWindowDimensions();

  const round = today.data;
  const allSealed = !!round && round.questions.length > 0 && round.questions.every((q) => answers[q.id]?.sealed);
  const yesterday = yesterdayOf(round?.date);

  return (
    <Screen>
      <Eyebrow>Oracle OS v1.0</Eyebrow>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(6) }}>
        {/* Temple moment: the near-touch, unframed — the art's parchment merges
            with the app ground so the hands float on the page itself. */}
        <Image
          source={require("../../assets/art/creation-hands-orb.jpg")}
          contentFit="cover"
          style={{ width: width - space(6), aspectRatio: 1408 / 768 }}
          accessible={false}
        />
        <Ritual bold size={52} color={colors.ink} letterSpacing={14} style={{ marginRight: -14 }}>ORACLE</Ritual>
        <View style={{ gap: space(2), alignItems: "center" }}>
          <Mono size={12} color={colors.mutedInk} style={{ textAlign: "center", lineHeight: 20 }}>{QUOTE}</Mono>
          <Mono size={10} color={colors.goldText} letterSpacing={3}>— YOGI BERRA</Mono>
        </View>
      </View>
      <View style={{ gap: space(3), paddingBottom: space(2) }}>
        {round && !allSealed && (
          <>
            <Mono size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}>
              {round.player_count > 0 ? `${round.player_count} ORACLES ALREADY WAITING` : "THE ORACLE SPEAKS"}
            </Mono>
            <GoldButton title="ENTER" onPress={() => router.push("/round")} />
          </>
        )}
        {round && allSealed && (
          <>
            <Mono size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}>THE PROPHECY IS SEALED</Mono>
            <GoldButton title="BEHOLD THE CROWD" onPress={() => router.push("/round")} />
            <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>THE LEDGER IS READ AT NOON</Mono>
          </>
        )}
        {!round && !today.isLoading && (
          <Mono size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>THE ORACLE SLEEPS</Mono>
        )}
        <QuietLink title="Yesterday's ledger" onPress={() => router.push(`/reveal/${yesterday}`)} />
      </View>
    </Screen>
  );
}
