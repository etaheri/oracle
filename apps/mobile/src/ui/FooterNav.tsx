import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, space } from "../theme";
import { Mono, role } from "./Text";

// `label` is the printed machine voice (terse, tracked caps); `a11yLabel` is
// what it is actually called, for anyone who hears the screen rather than
// reads it.
export type NavItem = { label: string; a11yLabel: string; onPress: () => void };

// The footer rail. Home's secondary destinations used to stack as three
// underlined QuietLinks — 168px of near-identical muted text that the notice
// line above them dissolved straight into. One bracketed row instead: the
// ladder is gone, the height goes back to the temple, and the brackets say
// "control" the way a terminal says it — no underline, no separators, and no
// divider rule needed above. Each item still owns a 44pt target.
export function FooterNav({ items }: { items: NavItem[] }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center" }}>
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          accessibilityLabel={item.a11yLabel}
          onPress={() => { Haptics.selectionAsync(); item.onPress(); }}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: space(1), justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
        >
          {/* Brackets in gilt, label in ink: the frame says "control" (it is
              the GoldButton's border, shrunk to two glyphs) while the label
              keeps the contrast that aged gold cannot carry at this size. */}
          <Mono {...role.line} color={colors.mutedInk}>
            <Text style={{ color: colors.agedGold }}>[</Text>
            {item.label}
            <Text style={{ color: colors.agedGold }}>]</Text>
          </Mono>
        </Pressable>
      ))}
    </View>
  );
}
