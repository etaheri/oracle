import { View } from "react-native";
import { Mono, Ritual } from "./Text";
import { colors, space } from "../theme";

// The conviction column: a glyph thermometer pinned to the screen edge the
// player is pulling toward — stationary while the card moves underneath.
// Nine cells, one per conviction step: every ratchet tick the hand feels
// prints exactly one cell the eye sees (a gauge prints, it doesn't slide).
// The carved percentage rides fixed at its head. Never interactive.
const CELLS = 9;

export function ConvictionColumn({ conf, side }: { conf: number; side: boolean }) {
  const tone = side ? colors.ultramarine : colors.vermilion;
  const filled = (conf - 55) / 5 + 1; // 1..9
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        ...(side ? { right: space(2) } : { left: space(2) }),
        justifyContent: "center",
        alignItems: "center",
        gap: space(2),
        zIndex: 10,
      }}
    >
      <Mono size={10} color={tone} letterSpacing={2} style={{ marginRight: -2 }}>{side ? "YES" : "NO"}</Mono>
      <Ritual bold size={24} color={tone}>{`${conf}%`}</Ritual>
      <View style={{ borderWidth: 1, borderColor: tone, backgroundColor: colors.frescoWhite, paddingVertical: 5, paddingHorizontal: 6, gap: 2, alignItems: "center" }}>
        {Array.from({ length: CELLS }, (_, i) => CELLS - 1 - i).map((row) => (
          <Mono key={row} size={13} color={row < filled ? tone : colors.line} style={{ lineHeight: 15 }}>
            {row < filled ? "#" : "·"}
          </Mono>
        ))}
      </View>
    </View>
  );
}
