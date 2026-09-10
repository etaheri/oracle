import { Pressable, View } from "react-native";
import { LADDER_CONFIDENCES } from "@oracle/core";
import { rungA11y, rungLabel, unstakedRungLabel } from "../game/stakeText";
import { formatFortune } from "../game/fortuneText";
import { Mono } from "./Text";
import { colors, space } from "../theme";

// The five rungs (design §8.2, D13): a row, not a column, so it fits under the
// question inside the card. Each rung shows its stake over its winnings; the
// readout under the row says the selected rung in full. Money, never
// confidence. Machine register: this is chrome.
export function StakeLadder({ rungs, selected, onSelect, disabled = false }: {
  rungs: Array<{ confidence: number; stake: number; wins: number }> | null;
  selected: number;
  onSelect: (confidence: number) => void;
  disabled?: boolean;
}) {
  const current = rungs?.find((r) => r.confidence === selected) ?? null;
  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: "row", gap: space(1) }}>
        {LADDER_CONFIDENCES.map((c) => {
          const r = rungs?.find((x) => x.confidence === c) ?? null;
          const sel = c === selected;
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityState={{ selected: sel, disabled }}
              accessibilityLabel={r ? rungA11y(r) : unstakedRungLabel(c)}
              disabled={disabled}
              onPress={() => onSelect(c)}
              style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: sel ? colors.agedGold : colors.line, backgroundColor: sel ? colors.goldWash : "transparent", alignItems: "center", justifyContent: "center", gap: 2 }}
            >
              <Mono size={13} color={sel ? colors.ink : colors.mutedInk} letterSpacing={1}>{r ? formatFortune(r.stake) : `${c}%`}</Mono>
              {r && <Mono size={9} color={sel ? colors.goldText : colors.mutedInk} letterSpacing={1}>{`+${formatFortune(r.wins)}`}</Mono>}
            </Pressable>
          );
        })}
      </View>
      <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>
        {current ? rungLabel(current) : unstakedRungLabel(selected)}
      </Mono>
    </View>
  );
}
