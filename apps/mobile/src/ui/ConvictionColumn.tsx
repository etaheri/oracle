import { View, Text } from "react-native";
import { Mono } from "./Text";
import { colors, fonts, space } from "../theme";

// The conviction column: a glyph thermometer pinned to the screen edge the
// player is pulling toward — stationary while the card moves underneath.
// Machine voice throughout (a gauge is chrome, not scripture). Nine cells,
// one per conviction step: every ratchet tick the hand feels prints exactly
// one cell the eye sees (a gauge prints, it doesn't slide).
//
// conf === null is the live-but-uncommitted pull: the column stands as
// unresolved static — muted, unlit, the percentage still noise — and snaps
// into the side's tone the moment 55% resolves at the commit thunk.
const CELLS = 9;

export function ConvictionColumn({ conf, side }: { conf: number | null; side: boolean }) {
  const committed = conf !== null;
  const tone = committed ? (side ? colors.ultramarine : colors.vermilion) : colors.mutedInk;
  const filled = committed ? (conf - 55) / 5 + 1 : 0; // 1..9 once committed
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
        opacity: committed ? 1 : 0.6,
      }}
    >
      <Mono size={10} color={tone} letterSpacing={2} style={{ marginRight: -2 }}>{side ? "YES" : "NO"}</Mono>
      <Text style={{ fontFamily: fonts.monoMedium, fontSize: 22, color: tone, letterSpacing: 1 }}>
        {committed ? `${conf}%` : "··%"}
      </Text>
      <View style={{ borderWidth: 1, borderColor: committed ? tone : colors.line, backgroundColor: colors.frescoWhite, paddingVertical: 5, paddingHorizontal: 6, gap: 2, alignItems: "center" }}>
        {Array.from({ length: CELLS }, (_, i) => CELLS - 1 - i).map((row) => (
          <Mono key={row} size={13} color={row < filled ? tone : colors.line} style={{ lineHeight: 15 }}>
            {row < filled ? "#" : "·"}
          </Mono>
        ))}
      </View>
    </View>
  );
}
