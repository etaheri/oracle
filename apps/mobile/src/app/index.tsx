import { useEffect, useState } from "react";
import { View } from "react-native";
import { Screen } from "../ui/Screen";
import { Mono, Eyebrow } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { LivingHero } from "../ui/LivingHero";
import { MaterializeTitle } from "../ui/MaterializeTitle";
import { Countdown } from "../ui/Countdown";
import { useToday, useCrowdSoFar, useMeLedger } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { crowdLean } from "../game/orbMood";
import { epigraphFor } from "../game/epigraph";
import { onBootDone } from "../game/bootGate";
import { vigilLine } from "@oracle/core";
import { colors, space } from "../theme";
import { useRouter } from "expo-router";

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
  // The daily placard: keyed to the round's date when the oracle is awake,
  // the device's otherwise — same date, same line, all day.
  const epigraph = epigraphFor(round?.date ?? new Date().toISOString().slice(0, 10));
  const ledger = useMeLedger();
  const vigil = vigilLine(ledger.data?.streak ?? 0, `home:${round?.date ?? ""}`);
  // Hold the print-in until the boot rite lifts — the static resolves in
  // view as the overlay fades, instead of playing unseen behind it.
  const [booted, setBooted] = useState(false);
  useEffect(() => onBootDone(() => setBooted(true)), []);

  return (
    <Screen>
      <Eyebrow>Oracle OS v1.0</Eyebrow>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(6) }}>
        {/* Temple moment: the near-touch, alive — transparent loop over the
            museum ground, glow tinted by the crowd's mood. */}
        <LivingHero lean={lean} />
        {/* The wordmark materializes out of ASCII (patina spec phase 2) and
            settles into carved stillness with a faint edge residue. */}
        <MaterializeTitle active={booted} />
        <View style={{ gap: space(2), alignItems: "center", paddingHorizontal: space(5) }}>
          <DecodeLine active={booted} text={`"${epigraph.text}"`} seed={epigraph.text} durationMs={700} size={12} color={colors.mutedInk} style={{ textAlign: "center", lineHeight: 20 }} />
          <DecodeLine active={booted} text={`— ${epigraph.source.toUpperCase()}`} seed={epigraph.source} delayMs={500} size={10} color={colors.goldText} letterSpacing={3} />
        </View>
      </View>
      <View style={{ gap: space(3), paddingBottom: space(2) }}>
        {round && !allSealed && (
          <>
            <DecodeLine
              active={booted}
              text={round.player_count > 0 ? `${round.player_count} ORACLES ALREADY WAITING` : "THE ORACLE SPEAKS"}
              size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}
            />
            <GoldButton title="ENTER" onPress={() => router.push("/round")} />
            <Countdown until={round.locks_at} prefix="THE ORACLE CLOSES IN" />
          </>
        )}
        {round && allSealed && (
          <>
            <DecodeLine active={booted} text="THE PROPHECY IS SEALED" size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2} />
            <GoldButton title="BEHOLD THE CROWD" onPress={() => router.push("/round")} />
            <Countdown until={round.locks_at} prefix="THE LEDGER IS READ IN" fallback="THE LEDGER IS READ AT NOON" />
          </>
        )}
        {!round && !today.isLoading && (
          <DecodeLine active={booted} text="THE ORACLE SLEEPS" cursor size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2} />
        )}
        {vigil && (
          <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>{vigil}</Mono>
        )}
        <QuietLink title="The forecaster's ledger" onPress={() => router.push("/ledger")} />
        <QuietLink title="Yesterday's ledger" onPress={() => router.push(`/reveal/${yesterday}`)} />
      </View>
    </Screen>
  );
}
