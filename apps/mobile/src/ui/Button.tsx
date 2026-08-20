import { Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, space } from "../theme";
import { Mono } from "./Text";

export function GoldButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }}
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: disabled ? colors.line : colors.gold,
        paddingVertical: space(3), alignItems: "center",
        opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
        backgroundColor: pressed ? colors.goldWash : "transparent",
      })}
    >
      <Mono size={12} color={disabled ? colors.ash : colors.gold} letterSpacing={6} style={{ textTransform: "uppercase" }}>{title}</Mono>
    </Pressable>
  );
}
