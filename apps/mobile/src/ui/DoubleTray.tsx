import { Pressable, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { TRAY_TITLE, TRAY_READ, type TrayTile } from "../game/doubleTray";
import { formatFortune } from "../game/fortuneText";
import { numeral } from "./CardChrome";
import { Mono, Ritual, Serif, role } from "./Text";
import { colors, space, displayScale } from "../theme";

// The tray (design 2026-09-14 §5.3): five large targets and nothing else. One
// tap places the double; there is no preselected tile, no undo, no second
// step. Tracked caps for what is recognised, sentence case for the one line
// that is read.
export function DoubleTray({ tiles, placedId, onPlace, pending, notice }: {
  tiles: TrayTile[];
  placedId: string | null;
  onPlace: (tile: TrayTile) => void;
  pending: boolean;
  // Set when a tap reached the server and was refused. The round screen owns
  // it, because only it knows how the request went.
  notice: string | null;
}) {
  return (
    <View style={{ flex: 1, gap: space(3), justifyContent: "center" }}>
      <View style={{ alignItems: "center", gap: space(1) }}>
        <Ritual bold size={displayScale.slot} color={colors.goldText} letterSpacing={4} style={{ marginRight: -4 }}>{TRAY_TITLE}</Ritual>
        <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "center" }]}>{TRAY_READ}</Mono>
        {notice && <Mono {...role.meta} color={colors.vermilion} style={[role.meta.style, { textAlign: "center" }]}>{notice}</Mono>}
      </View>
      <View style={{ gap: space(2) }}>
        {tiles.map((t, i) => {
          const placed = placedId === t.id;
          const choosable = placedId === null && !t.locked && !pending;
          const tone = t.answer ? colors.ultramarine : colors.vermilion;
          const money = placed
            ? `STAKE ${formatFortune(t.doubledStake)} · WINS ${formatFortune(t.doubledWins)}`
            : `STAKE ${formatFortune(t.stake)} → ${formatFortune(t.doubledStake)} · WINS ${formatFortune(t.wins)} → ${formatFortune(t.doubledWins)}`;
          return (
            <Animated.View key={t.id} entering={FadeInDown.delay(i * 60).duration(300)}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !choosable, selected: placed }}
                accessibilityLabel={`${t.isBigOne ? "The Big One, " : ""}question ${t.slot}. ${t.text} You said ${t.answer ? "yes" : "no"}, stake ${t.stake}, doubled ${t.doubledStake}${t.locked ? ", locked" : ""}`}
                disabled={!choosable}
                onPress={() => onPlace(t)}
                style={{ borderWidth: 1, borderColor: placed ? colors.agedGold : t.locked ? colors.lineSoft : colors.line, backgroundColor: placed ? colors.goldWash : "transparent", opacity: t.locked || (placedId !== null && !placed) ? 0.45 : 1, padding: space(3), gap: space(1), minHeight: 64 }}
              >
                <View style={{ flexDirection: "row", gap: space(2), alignItems: "baseline" }}>
                  <Ritual size={displayScale.slot} color={placed ? colors.goldText : colors.mutedInk} letterSpacing={1}>{numeral(t.slot)}</Ritual>
                  {t.isBigOne && <Mono size={9} color={colors.goldText} letterSpacing={3}>THE BIG ONE</Mono>}
                  <Mono size={10} color={tone} letterSpacing={3} style={{ marginLeft: "auto" }}>{t.answer ? "YES" : "NO"}</Mono>
                </View>
                <Serif size={displayScale.inline} color={colors.ink} numberOfLines={2} style={{ lineHeight: 21 }}>{t.text}</Serif>
                <Mono size={9} color={placed ? colors.goldText : colors.mutedInk} letterSpacing={1}>{placed ? `${money} · DOUBLED` : money}</Mono>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}
