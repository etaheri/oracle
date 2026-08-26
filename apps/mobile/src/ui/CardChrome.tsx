import { View } from "react-native";
import { colors, space } from "../theme";
import { Ritual, Mono, Eyebrow } from "./Text";

export const NUMERALS = ["I", "II", "III", "IV", "V"] as const;
export function numeral(slot: number): string {
  return NUMERALS[slot - 1] ?? String(slot);
}

const INSET = 9;
const TICK = 14;
const OVER = 5; // how far register marks overshoot the frame corner

// Register marks: the frame's rules extended past each corner — the shared
// glyph of antique card printing and technical drawings (see design/references).
function RegisterMarks() {
  const ticks: { top?: number; bottom?: number; left?: number; right?: number; w: number; h: number }[] = [];
  for (const v of ["top", "bottom"] as const) {
    for (const h of ["left", "right"] as const) {
      ticks.push({ [v]: INSET, [h]: INSET - OVER, w: TICK, h: 1 });
      ticks.push({ [v]: INSET - OVER, [h]: INSET, w: 1, h: TICK });
    }
  }
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", top: INSET, bottom: INSET, left: INSET, right: INSET, borderWidth: 1, borderColor: colors.lineSoft }} />
      {ticks.map((t, i) => (
        <View key={i} pointerEvents="none" style={{ position: "absolute", top: t.top, bottom: t.bottom, left: t.left, right: t.right, width: t.w, height: t.h, backgroundColor: colors.line }} />
      ))}
    </>
  );
}

export function CardChrome({ slot, title, caption, big = false, fill = false, children }: {
  slot: number; title: string; caption?: string; big?: boolean; fill?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={{ borderWidth: 1, borderColor: big ? colors.gold : colors.line, backgroundColor: colors.vellum, padding: space(6), paddingVertical: space(5), ...(fill ? { flex: 1 } : null) }}>
      <RegisterMarks />
      <View style={{ alignItems: "center", gap: space(1) }}>
        <Ritual bold size={13} color={colors.goldDeep} letterSpacing={4} style={{ marginRight: -4 }}>{numeral(slot)}</Ritual>
        <Eyebrow>{title}</Eyebrow>
        <View style={{ height: 1, alignSelf: "stretch", backgroundColor: colors.lineSoft, marginTop: space(1) }} />
      </View>
      <View style={{ gap: space(3), paddingVertical: space(3), ...(fill ? { flex: 1 } : null) }}>{children}</View>
      {caption ? (
        <Mono size={9} color={colors.umber} letterSpacing={2} style={{ textAlign: "center" }}>{caption}</Mono>
      ) : null}
    </View>
  );
}
