import { Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, space } from "../theme";
import { Mono, role } from "./Text";

export function GoldButton({ title, onPress, disabled, destructive = false }: { title: string; onPress: () => void; disabled?: boolean; destructive?: boolean }) {
  // A destructive rite must not press like an invitation: it wears the
  // vermilion sleeve, and its press is a warning weight rather than the
  // medium tap that confirms an ordinary action.
  const tone = destructive ? colors.vermilion : colors.agedGold;
  const textTone = destructive ? colors.vermilion : colors.goldText;
  const wash = destructive ? colors.vermilionWash : colors.goldWash;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(destructive ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: disabled ? colors.line : tone,
        minHeight: 48, justifyContent: "center", alignItems: "center",
        paddingVertical: space(3), paddingHorizontal: space(4),
        opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
        backgroundColor: pressed ? wash : "transparent",
      })}
    >
      <Mono {...role.action} color={disabled ? colors.mutedInk : textTone} style={[role.action.style, { textTransform: "uppercase" }]}>{title}</Mono>
    </Pressable>
  );
}

// Quiet secondary action — machine voice, no frame. One gold frame per screen.
export function QuietLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => ({ minHeight: 44, paddingVertical: space(2), paddingHorizontal: space(2), justifyContent: "center", alignItems: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Mono {...role.line} color={colors.mutedInk} style={[role.line.style, { textTransform: "uppercase", textDecorationLine: "underline" }]}>{title}</Mono>
    </Pressable>
  );
}
