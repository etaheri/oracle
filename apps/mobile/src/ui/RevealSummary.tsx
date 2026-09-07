import { View } from "react-native";
import { calculateDuel, dayCallCounts, type Reveal } from "@oracle/core";
import { revealSummary } from "../game/revealSummary";
import { revealObservation } from "../game/revealObservation";
import { Serif, Mono, Eyebrow, role } from "./Text";
import { DuelPortrait } from "./DuelPortrait";
import { GoldFrame } from "./GoldFrame";
import { revealLearning } from "../game/revealLearning";
import { ResolutionEvidence } from "./ResolutionEvidence";
import { colors, space } from "../theme";
export function RevealSummary({ data, milestone }: { data: Reveal; milestone: string | null }) {
  const qs = data.questions.map(q => ({ ...q, is_big_one: q.slot === 5 }));
  const duel = calculateDuel(qs, data.rules_version);
  const summary = revealSummary(qs, duel);
  const legacy = data.rules_version < 2;
  if (legacy && !qs.some(q => q.outcome === null)) {
    const counts = dayCallCounts(qs);
    summary.headline = `${counts.you} RIGHT · ${qs.filter(q => q.my && (q.outcome === "yes" || q.outcome === "no")).length} CALLS READ`;
    summary.explanation = "THIS ROUND USES THE ORIGINAL RULES. ITS RECORDED RESULT IS UNCHANGED.";
  }
  const highlight = data.questions.find(q => q.id === summary.highlightId);
  const learning = highlight ? revealLearning({ ...highlight, is_big_one: highlight.slot === 5 }, data.rules_version, duel) : null;
  const observation = learning ? null : revealObservation(qs);
  return <View style={{ gap: space(4) }}>
    <Serif size={26} style={{ textAlign: "center" }}>{summary.headline}</Serif>
    {!legacy && duel.status === "complete" && <DuelPortrait duel={duel} />}
    {highlight && <GoldFrame><View style={{ padding: space(4), gap: space(2) }}>
      <Eyebrow>{!legacy && duel.status === "complete" && duel.winner !== "tie" ? "The largest difference" : "A call to remember"}</Eyebrow>
      <Serif size={20}>{highlight.text}</Serif>
      <Mono {...role.supporting}>YOU {highlight.my?.answer ? "YES" : "NO"} AT {highlight.my?.confidence}% · ANSWER {highlight.outcome?.toUpperCase()}</Mono>
      {learning && <>
        <Mono {...role.supporting}>{`${learning.playerBasePoints > 0 ? "+" : ""}${learning.playerBasePoints} BASE POINTS${learning.doubleWeight ? " · DOUBLE WEIGHT" : ""}`}</Mono>
        <Mono {...role.supporting}>Higher confidence makes a correct call worth more and a miss cost more.</Mono>
        {learning.oracleBasePoints !== null && <Mono {...role.supporting}>{`THE ORACLE: ${learning.oracleBasePoints > 0 ? "+" : ""}${learning.oracleBasePoints} BASE POINTS · YOUR GAP: ${learning.gap! > 0 ? "+" : ""}${learning.gap}`}</Mono>}
      </>}
      <ResolutionEvidence question={highlight} />
    </View></GoldFrame>}
    {!legacy && duel.status === "complete" && duel.youCorrect > duel.oracleCorrect && duel.winner === "oracle" && <Mono {...role.supporting}>MORE RIGHT ANSWERS, BUT FEWER CONFIDENCE POINTS.</Mono>}
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>{summary.explanation}</Mono>
    {(milestone || observation) && <Mono color={colors.goldText} style={{ textAlign: "center" }}>{milestone ?? observation}</Mono>}
  </View>;
}
