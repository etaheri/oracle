import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { colors, space } from "../theme";
import { Serif, Mono, Eyebrow } from "./Text";
import { useCrowdSoFar } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { asciiGauge } from "../game/terminalPrint";
import type { RoundToday } from "@oracle/core";

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
              <Serif size={15} color={colors.mutedInk} numberOfLines={2}>{q.text}</Serif>
              <CrowdBar pct={c.crowd_yes_pct} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Mono size={10} color={colors.goldText}>{c.crowd_yes_pct}% SAY YES</Mono>
                <Mono size={10} color={mySidePct < 40 ? colors.goldText : colors.mutedInk}>
                  {mine.answer ? "YOU: YES" : "YOU: NO"} @ {mine.confidence}%{mySidePct < 40 ? " · AGAINST THE TIDE" : ""}
                </Mono>
              </View>
            </View>
          );
        })}
      </View>
      <Mono size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}>
        {playerCount} ORACLES CONSULTED
      </Mono>
      <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }}>
        The ledger is read tomorrow at noon.
      </Mono>
    </View>
  );
}
