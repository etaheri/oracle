import { View } from "react-native";
import { Image } from "expo-image";
import type { DuelResult } from "@oracle/core";
import { Mono, Ritual, role } from "./Text";
import { colors, space } from "../theme";

export const DUEL_ART = require("../../assets/art/creation-hands-orb.jpg");

// Left marble hand = player; right painted hand = Oracle, on every result.
export function DuelPortrait({ duel }: { duel: Extract<DuelResult, { status: "complete" }> }) {
  return <View style={{ gap: space(3) }}>
    <Image source={DUEL_ART} contentFit="contain" accessible={false}
      style={{ width: "100%", aspectRatio: 1408 / 768 }} />
    <View style={{ flexDirection: "row" }}>
      {([
        { label: "YOU", points: duel.youPoints, correct: duel.youCorrect, winner: duel.winner === "you" },
        { label: "THE ORACLE", points: duel.oraclePoints, correct: duel.oracleCorrect, winner: duel.winner === "oracle" },
      ]).map((side, index) => <View key={side.label} style={{ flex: 1, minWidth: 0, alignItems: "center", gap: space(2), paddingHorizontal: space(2), borderLeftWidth: index ? 1 : 0, borderColor: colors.lineSoft }}>
        <Mono size={11} color={side.winner ? colors.goldText : colors.mutedInk}>{side.label}</Mono>
        <Ritual bold size={28} color={side.winner ? colors.goldText : colors.ink} style={{ textAlign: "center" }}>{side.points}</Ritual>
        <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{side.correct}/{duel.scoredCount} RIGHT</Mono>
      </View>)}
    </View>
    <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>CONFIDENCE POINTS · SAME RULES FOR BOTH</Mono>
    {duel.oracleAbstained > 0 && <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>ORACLE WITHOUT A SIDE ON {duel.oracleAbstained}</Mono>}
  </View>;
}
