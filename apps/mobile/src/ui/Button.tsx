import { Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, space } from "../theme";
import { Ritual, Mono } from "./Text";

export function GoldButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }}
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: disabled ? colors.line : colors.gold,
        minHeight: 48, justifyContent: "center", alignItems: "center",
        paddingVertical: space(3), paddingHorizontal: space(4),
        opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
        backgroundColor: pressed ? colors.goldWash : "transparent",
      })}
    >
      <Ritual size={13} color={disabled ? colors.umber : colors.goldDeep} letterSpacing={4} style={{ textTransform: "uppercase", marginRight: -4 }}>{title}</Ritual>
    </Pressable>
  );
}

// Quiet secondary action — machine voice, no frame. One gold frame per screen.
export function QuietLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", alignItems: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Mono size={11} color={colors.umber} letterSpacing={3} style={{ textTransform: "uppercase", textDecorationLine: "underline" }}>{title}</Mono>
    </Pressable>
  );
}
