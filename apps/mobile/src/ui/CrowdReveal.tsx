import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { colors, space } from "../theme";
import { Serif, Mono, Eyebrow } from "./Text";
import { GoldButton } from "./Button";
import { GoldFrame } from "./GoldFrame";
import { useCrowdSoFar } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { asciiGauge } from "../game/terminalPrint";
import { GATHERING_LINE, VERDICT_MIN_PLAYERS } from "../game/crowdVerdict";
import { contrarianApplies, type RoundToday } from "@oracle/core";

// The crowd bar in the machine's own alphabet: [#######·····], the fill
// printing cell by cell. Stepped at 50ms — a gauge prints, it doesn't slide.
const GAUGE_MS = 600;

export function CrowdBar({ pct }: { pct: number }) {
  const reducedMotion = useReducedMotion();
  const [progress, setProgress] = useState(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) { setProgress(1); return; }
    setProgress(0);
    const t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / GAUGE_MS);
      setProgress(p);
      if (p >= 1) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [pct, reducedMotion]);

  const gauge = asciiGauge(pct, progress);
  const fillEnd = Math.max(1, gauge.lastIndexOf("#") + 1);
  return (
    <Mono size={11} color={colors.goldText} letterSpacing={1}>
      {gauge.slice(0, fillEnd)}
      <Text style={{ color: colors.lineSoft }}>{gauge.slice(fillEnd, -1)}</Text>
      {"]"}
    </Mono>
  );
}

export function CrowdReveal({ round }: { round: RoundToday }) {
  const router = useRouter();
  const crowd = useCrowdSoFar(true);
  const answers = useRoundStore((s) => s.answers);
  const byId = new Map((crowd.data?.questions ?? []).map((c) => [c.id, c]));
  const sealed = round.questions.filter((q) => answers[q.id]?.sealed);
  const playerCount = Math.max(0, ...sealed.map((q) => (byId.get(q.id)?.player_count ?? 0)));

  return (
    <View style={{ flex: 1, gap: space(4) }}>
      <Eyebrow>Your sealed calls</Eyebrow>
      {/* The round's second artifact (refinement spec §5). It followed a
          gilded card and arrived as an unframed list; the gold-leaf frame
          says this is the same document, now countersigned by the crowd. */}
      <GoldFrame style={{ flex: 1, backgroundColor: colors.frescoWhite }}>
        <View style={{ flex: 1, padding: space(4), gap: space(4) }}>
          {/* The verdicts scroll inside the frame. This is a full-screen
              composition with a padded, gilded border and free-scaling Serif
              in it, and there is no other page to spill onto: at a large text
              size five prophecies push the countersignature below out of the
              frame entirely. The scroller flexes, so with a short spread it
              still holds the footer at the foot exactly as the spacer it
              replaces did. */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space(4) }} showsVerticalScrollIndicator contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
            {sealed.map((q) => {
              const c = byId.get(q.id);
              const mine = answers[q.id]!;
              const mySidePct = mine.answer ? (c?.crowd_yes_pct ?? 50) : 100 - (c?.crowd_yes_pct ?? 50);
              const against = contrarianApplies(mySidePct, c?.player_count ?? 0);
              // Under the floor the percentage is mostly the player: at one
              // sealed answer this frame printed a full gauge and "100% SAY
              // YES" directly above a footer reading "1 ORACLE HAS SPOKEN".
              // The round's footer verdict already holds its tongue here
              // (crowdVerdict); the finale now holds it from the same floor
              // and the same string. The player's own call still prints —
              // it is the one thing that is true at any crowd size.
              const gathering = !c || c.player_count < VERDICT_MIN_PLAYERS;
              return (
                <View key={q.id} style={{ gap: space(2) }}>
                  <Serif size={15} color={colors.ink} numberOfLines={2}>{q.text}</Serif>
                  {!gathering && c && (
                    <CrowdBar pct={c.crowd_yes_pct} />
                  )}
                  <View style={{ flexDirection: "row", justifyContent: gathering ? "flex-end" : "space-between" }}>
                    {!gathering && <Mono size={10} color={colors.goldText}>{c!.crowd_yes_pct}% SAY YES</Mono>}
                    <Mono size={10} color={against ? colors.goldText : colors.mutedInk}>
                      {mine.answer ? "YOU: YES" : "YOU: NO"} @ {mine.confidence}%{against ? " · AGAINST THE TIDE" : ""}
                    </Mono>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.4 }} />
          <View style={{ gap: space(1) }}>
            <Mono size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}>
              {playerCount < VERDICT_MIN_PLAYERS ? GATHERING_LINE : `${playerCount} ORACLES HAVE SPOKEN`}
            </Mono>
            <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={1}>
              THE LEDGER IS READ AFTER THE QUESTIONS CLOSE
            </Mono>
          </View>
        </View>
      </GoldFrame>
      <View style={{ paddingBottom: space(2) }}>
        <GoldButton title="RETURN" onPress={() => router.dismissTo("/")} />
      </View>
    </View>
  );
}
