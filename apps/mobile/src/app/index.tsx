import { View } from "react-native";
import { Screen } from "../ui/Screen";
import { Serif, Mono, Ritual, Eyebrow } from "../ui/Text";
import { GoldButton, QuietLink } from "../ui/Button";
import { LivingHero } from "../ui/LivingHero";
import { Countdown } from "../ui/Countdown";
import { useToday, useCrowdSoFar } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { crowdLean } from "../game/orbMood";
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
  const anySealed = !!round && round.questions.some((q) => answers[q.id]?.sealed);
  const crowd = useCrowdSoFar(anySealed);
  const lean = crowdLean(crowd.data?.questions ?? []);
  useHydratePlayedState(!!round);

  return (
    <Screen>
      <Eyebrow>Oracle OS v1.0</Eyebrow>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(6) }}>
        {/* Temple moment: the near-touch, alive — transparent loop over the
            museum ground, glow tinted by the crowd's mood. */}
        <LivingHero lean={lean} />
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
            <Countdown until={round.locks_at} prefix="THE ORACLE CLOSES IN" />
          </>
        )}
        {round && allSealed && (
          <>
            <Mono size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}>THE PROPHECY IS SEALED</Mono>
            <GoldButton title="BEHOLD THE CROWD" onPress={() => router.push("/round")} />
            <Countdown until={round.locks_at} prefix="THE LEDGER IS READ IN" fallback="THE LEDGER IS READ AT NOON" />
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
