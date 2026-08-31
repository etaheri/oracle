import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Screen } from "../ui/Screen";
import { Mono, Eyebrow } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { LivingHero } from "../ui/LivingHero";
import { MaterializeTitle } from "../ui/MaterializeTitle";
import { Countdown } from "../ui/Countdown";
import { SleepsPanel } from "../ui/SleepsPanel";
import { useToday, useCrowdSoFar, useMeLedger, useReveal } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { crowdLean } from "../game/orbMood";
import { epigraphFor } from "../game/epigraph";
import { onBootDone } from "../game/bootGate";
import { shieldNotice } from "../game/shieldNotice";
import { revealReady } from "../game/revealReady";
import { partialLine, spokenLine, riskLine, lapseNotice } from "../game/homeLines";
import { msUntil } from "../game/countdown";
import { getRevealSeen, getRitesSeen } from "../api/flags";
import { resealReminders } from "../notifications/schedule";
import { maybeSummon } from "../notifications/summons";
import { vigilLine, COPY_BANK } from "@oracle/core";
import { colors, space } from "../theme";
import { useFocusEffect, useRouter } from "expo-router";

const READING_LINE = COPY_BANK.find((l) => l.id === "system.reading-1")!.text;

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
  const sealedCount = round ? round.questions.filter((q) => answers[q.id]?.sealed).length : 0;
  const partial = round ? partialLine(sealedCount, round.questions.length) : null;
  useEffect(() => {
    if (round?.locks_at) void resealReminders(round.locks_at, round.date, sealedCount);
  }, [round?.date, round?.locks_at, sealedCount]);
  const yesterday = yesterdayOf(round?.date);
  const reveal = useReveal(yesterday);
  const playedYesterday = reveal.data && !("pending" in reveal.data) ? reveal.data.questions.some((q) => q.my !== null) : null;
  const [revealSeen, setRevealSeen] = useState<string | null>(null);
  const [ritesSeen, setRitesSeen] = useState(true); // optimistic: never flash the gate at a veteran
  const anySealed = !!round && round.questions.some((q) => answers[q.id]?.sealed);
  // Home never remounts under the Stack (back-nav from /reveal or /rites just
  // refocuses it), so re-read both flags on every focus, not just on mount.
  useFocusEffect(
    useCallback(() => {
      void getRevealSeen().then(setRevealSeen);
      void getRitesSeen().then(setRitesSeen);
      // Covers the partial player: round.tsx only fires the summons on the
      // full seal, so someone who never returns to a finished spread is
      // still asked here, once, on any focus after their first seal.
      if (anySealed) void maybeSummon((href) => router.push(href));
    }, [anySealed, router])
  );
  const showLedgerCta = revealReady(reveal.data) && revealSeen !== yesterday;
  const crowd = useCrowdSoFar(anySealed);
  const lean = crowdLean(crowd.data?.questions ?? []);
  useHydratePlayedState(!!round);
  // The daily placard: keyed to the round's date when the oracle is awake,
  // the device's otherwise — same date, same line, all day.
  const epigraph = epigraphFor(round?.date ?? new Date().toISOString().slice(0, 10));
  const ledger = useMeLedger();
  const vigil = vigilLine(ledger.data?.streak ?? 0, `home:${round?.date ?? ""}`);
  const shield = shieldNotice(ledger.data?.shield_used_on ?? null, yesterday);
  // Re-evaluated every 30s so the risk line can appear without a remount —
  // Home never remounts under the Stack (see the focus effect above).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const risk = riskLine(ledger.data?.streak ?? 0, anySealed, msUntil(round?.locks_at ?? null, now), `risk:${round?.date ?? ""}`);
  const lapse = lapseNotice(ledger.data?.days_consulted ?? 0, ledger.data?.streak ?? 0, playedYesterday, `lapse:${yesterday}`);
  const notice = shield ?? risk ?? lapse ?? vigil;
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
        {showLedgerCta && (
          <>
            <DecodeLine active={booted} text="THE LEDGER IS READ" size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2} />
            <GoldButton title="READ THE LEDGER" onPress={() => router.push(`/reveal/${yesterday}`)} />
          </>
        )}
        {round && !allSealed && (
          <>
            <DecodeLine
              active={booted}
              text={partial ?? spokenLine(round.player_count)}
              size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}
            />
            {showLedgerCta ? (
              <QuietLink title="Enter today's round" onPress={() => router.push(ritesSeen ? "/round" : "/rites")} />
            ) : (
              <GoldButton title="ENTER" onPress={() => router.push(ritesSeen ? "/round" : "/rites")} />
            )}
            <Countdown until={round.locks_at} prefix="THE ORACLE CLOSES IN" />
          </>
        )}
        {round && allSealed && (
          <>
            <DecodeLine active={booted} text="THE PROPHECY IS SEALED" size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2} />
            {showLedgerCta ? (
              <QuietLink title="Behold the crowd" onPress={() => router.push("/round")} />
            ) : (
              <GoldButton title="BEHOLD THE CROWD" onPress={() => router.push("/round")} />
            )}
            <Countdown until={round.locks_at} prefix="THE LEDGER IS READ IN" fallback={READING_LINE} />
          </>
        )}
        {!round && !today.isLoading && <SleepsPanel active={booted} />}
        {notice && (
          <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>{notice}</Mono>
        )}
        <QuietLink title="The forecaster's ledger" onPress={() => router.push("/ledger")} />
        {!showLedgerCta && <QuietLink title="Yesterday's ledger" onPress={() => router.push(`/reveal/${yesterday}`)} />}
        <QuietLink title="The rites" onPress={() => router.push("/rites")} />
      </View>
    </Screen>
  );
}
