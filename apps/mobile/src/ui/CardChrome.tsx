import { View } from "react-native";
import { colors, space, displayScale } from "../theme";
import { Ritual, Mono, Eyebrow } from "./Text";
import { NUMERALS, numeral } from "../game/numerals";
import { useChromeScale } from "./useChromeScale";

export { NUMERALS, numeral };

// Tarot proportion (brief §3: "large areas of quiet negative space are
// essential") — the card is an object you drew, not a form you fill.
const DECK_RATIO = 0.7;

const INSET = 9;
const MARK_BOX = 14; // the glyph's centring box at 1x, straddling the rule's corner

// Register marks: the frame's corners, drawn as the machine's own '+' rather
// than as rectangles (refinement spec §1.1). Same silhouette as the antique
// card-printing / technical-drawing mark they replace, but now the frame is
// type — it belongs to the same alphabet as the coordinate and the status.
export function RegisterMarks() {
  // The box scales with the '+' inside it. The mark is type now, so it grows
  // with the reader's text size like the rest of the chrome — and a fixed box
  // would stop containing its own glyph's line box at the cap, decentring the
  // mark off the corner it registers and cropping it on Android.
  const box = Math.ceil(MARK_BOX * useChromeScale());
  const corners = [
    { top: INSET - box / 2, left: INSET - box / 2 },
    { top: INSET - box / 2, right: INSET - box / 2 },
    { bottom: INSET - box / 2, left: INSET - box / 2 },
    { bottom: INSET - box / 2, right: INSET - box / 2 },
  ];
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", top: INSET, bottom: INSET, left: INSET, right: INSET, borderWidth: 1, borderColor: colors.lineSoft }} />
      {corners.map((c, i) => (
        <View key={i} pointerEvents="none" style={{ position: "absolute", ...c, width: box, height: box, alignItems: "center", justifyContent: "center" }}>
          <Mono size={11} color={colors.mark} letterSpacing={0} style={{ lineHeight: box }}>+</Mono>
        </View>
      ))}
    </>
  );
}

// The card's terminal margin (brief §8: "a feature card reveals a static
// terminal coordinate or symbol cluster"). Two quiet mono fields, optically
// symmetric: provenance on the left, live state on the right.
export function CardChrome({ slot, title, modifiers, coordinate, status, big = false, fill = false, height, children }: {
  slot: number;
  // The category alone. Modifiers ride their own line — a single long title
  // wrapped badly at the eyebrow's tracking.
  title: string;
  modifiers?: string;
  coordinate?: string;
  status?: string;
  big?: boolean;
  fill?: boolean;
  height?: number;
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
        ...(fill ? { flex: 1 } : height !== undefined ? { height } : { aspectRatio: DECK_RATIO }),
      }}
    >
      <RegisterMarks />
      <View style={{ alignItems: "center", gap: space(2) }}>
        <Ritual bold size={displayScale.stamp} color={colors.goldText} letterSpacing={5} style={{ marginRight: -5 }}>{numeral(slot)}</Ritual>
        {/* Brackets are the app's terminal signature (they frame the footer
            rail's controls). On an undealt card the contents are static and
            the brackets stay solid — the frame is known, the prophecy is not. */}
        <Eyebrow>{`[ ${title} ]`}</Eyebrow>
        {modifiers ? (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>{modifiers}</Mono>
        ) : null}
      </View>
      <View style={{ flex: 1, minHeight: 0, gap: space(3), paddingTop: space(3) }}>{children}</View>
      {/* One row, not two independent corners. Pinned to opposite edges these
          two fields simply grew into each other: IBM Plex Mono advances 0.6em,
          so at size 10 a full coordinate runs ~238pt from the left while a
          ticking LOCK ends ~84pt in from the right — they cross on a 375pt
          device. A flex row makes the collision impossible, and the coordinate
          is the side that gives way: the status is the half that is alive, so
          the provenance is what truncates. */}
      {coordinate || status ? (
        <View style={{ position: "absolute", left: INSET + 11, right: INSET + 11, bottom: INSET + 8, flexDirection: "row", alignItems: "flex-end", gap: space(2) }}>
          <Mono size={10} color={colors.mutedInk} letterSpacing={1} numberOfLines={1} style={{ flex: 1 }}>
            {coordinate}
          </Mono>
          {status ? (
            <Mono size={10} color={colors.mutedInk} letterSpacing={1}>
              {status}
            </Mono>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
