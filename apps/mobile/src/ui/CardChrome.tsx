import { View } from "react-native";
import { colors, space } from "../theme";
import { Ritual, Mono, Eyebrow } from "./Text";
import { NUMERALS, numeral } from "../game/numerals";

export { NUMERALS, numeral };

// Tarot proportion (brief §3: "large areas of quiet negative space are
// essential") — the card is an object you drew, not a form you fill.
const DECK_RATIO = 0.7;

const INSET = 9;
const MARK_BOX = 14; // the glyph's centring box, straddling the rule's corner

// Register marks: the frame's corners, drawn as the machine's own '+' rather
// than as rectangles (refinement spec §1.1). Same silhouette as the antique
// card-printing / technical-drawing mark they replace, but now the frame is
// type — it belongs to the same alphabet as the coordinate and the status.
function RegisterMarks() {
  const corners = [
    { top: INSET - MARK_BOX / 2, left: INSET - MARK_BOX / 2 },
    { top: INSET - MARK_BOX / 2, right: INSET - MARK_BOX / 2 },
    { bottom: INSET - MARK_BOX / 2, left: INSET - MARK_BOX / 2 },
    { bottom: INSET - MARK_BOX / 2, right: INSET - MARK_BOX / 2 },
  ];
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", top: INSET, bottom: INSET, left: INSET, right: INSET, borderWidth: 1, borderColor: colors.lineSoft }} />
      {corners.map((c, i) => (
        <View key={i} pointerEvents="none" style={{ position: "absolute", ...c, width: MARK_BOX, height: MARK_BOX, alignItems: "center", justifyContent: "center" }}>
          <Mono size={11} color={colors.mark} letterSpacing={0} style={{ lineHeight: MARK_BOX }}>+</Mono>
        </View>
      ))}
    </>
  );
}

// The card's terminal margin (brief §8: "a feature card reveals a static
// terminal coordinate or symbol cluster"). Two quiet mono fields, optically
// symmetric: provenance on the left, live state on the right.
export function CardChrome({ slot, title, modifiers, coordinate, status, big = false, fill = false, children }: {
  slot: number;
  // The category alone. Modifiers ride their own line — a single long title
  // wrapped badly at the eyebrow's tracking.
  title: string;
  modifiers?: string;
  coordinate?: string;
  status?: string;
  big?: boolean;
  fill?: boolean;
  children: React.ReactNode;
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
        {/* Brackets are the app's terminal signature (they frame the footer
            rail's controls). On an undealt card the contents are static and
            the brackets stay solid — the frame is known, the prophecy is not. */}
        <Eyebrow>{`[ ${title} ]`}</Eyebrow>
        {modifiers ? (
          <Mono size={9.5} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>{modifiers}</Mono>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: space(3), paddingTop: space(3) }}>{children}</View>
      {coordinate ? (
        <Mono size={8.5} color={colors.mutedInk} letterSpacing={1.5} style={{ position: "absolute", left: INSET + 11, bottom: INSET + 8 }}>
          {coordinate}
        </Mono>
      ) : null}
      {status ? (
        <Mono size={8.5} color={colors.mutedInk} letterSpacing={1.5} style={{ position: "absolute", right: INSET + 11, bottom: INSET + 8 }}>
          {status}
        </Mono>
      ) : null}
    </View>
  );
}
