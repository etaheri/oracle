import { View } from "react-native";
import { ladderTable } from "../game/stakeText";
import { Mono, role } from "./Text";
import { colors, space } from "../theme";

// The five rungs as a table (design §8.3): rung, share of fortune, on the Big
// One, and the stake at a founding fortune. Machine register: a table is
// recognised, not read.
export function LadderTable() {
  const rows = [{ rung: "RUNG", percent: "STAKE", bigOne: "BIG ONE", example: "AT 1,000" }, ...ladderTable()];
  return (
    <View style={{ gap: space(1) }}>
      {rows.map((r, i) => (
        <View key={r.rung} style={{ flexDirection: "row", gap: space(2) }}>
          {[r.rung, r.percent, r.bigOne, r.example].map((cell, j) => (
            <Mono key={j} {...role.meta} color={i === 0 ? colors.mutedInk : colors.ink} style={[role.meta.style, { flex: j === 0 ? 0.6 : 1, textAlign: j === 0 ? "left" : "right" }]}>{cell}</Mono>
          ))}
        </View>
      ))}
    </View>
  );
}
