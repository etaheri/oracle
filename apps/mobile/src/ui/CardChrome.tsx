import { View } from "react-native";
import { colors, space } from "../theme";
import { Ritual, Mono, Eyebrow } from "./Text";
import { NUMERALS, numeral } from "../game/numerals";

export { NUMERALS, numeral };

// Tarot proportion (brief §3: "large areas of quiet negative space are
// essential") — the card is an object you drew, not a form you fill.
const DECK_RATIO = 0.7;

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

// coordinate: the card's one terminal detail (brief §8: "a feature card
// reveals a static terminal coordinate or symbol cluster") — a quiet mono
// line tucked into the bottom margin, discovered rather than announced.
export function CardChrome({ slot, title, coordinate, big = false, fill = false, children }: {
  slot: number; title: string; coordinate?: string; big?: boolean; fill?: boolean; children: React.ReactNode;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: big ? colors.agedGold : colors.line,
        backgroundColor: colors.frescoWhite,
        paddingHorizontal: space(6),
        paddingTop: space(6),
        paddingBottom: space(9),
        ...(fill ? { flex: 1 } : { aspectRatio: DECK_RATIO }),
      }}
    >
      <RegisterMarks />
      <View style={{ alignItems: "center", gap: space(2) }}>
        <Ritual bold size={18} color={colors.goldText} letterSpacing={5} style={{ marginRight: -5 }}>{numeral(slot)}</Ritual>
        <Eyebrow>{title}</Eyebrow>
      </View>
      <View style={{ flex: 1, gap: space(3), paddingTop: space(3) }}>{children}</View>
      {coordinate ? (
        <Mono size={8.5} color={colors.mutedInk} letterSpacing={1.5} style={{ position: "absolute", left: INSET + 11, bottom: INSET + 8 }}>
          {coordinate}
        </Mono>
      ) : null}
    </View>
  );
}
