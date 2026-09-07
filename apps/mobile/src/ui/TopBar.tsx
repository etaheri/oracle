import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../theme";
import { Mono } from "./Text";

export function TopBar({ label, showReturn = true }: { label?: string; showReturn?: boolean }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      {showReturn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return"
          hitSlop={8}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={({ pressed }) => ({ minHeight: 44, minWidth: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Mono size={11} color={colors.goldText} letterSpacing={2}>‹ RETURN</Mono>
        </Pressable>
      ) : (
        // The gate keeps its 44pt bar so the eyebrow below does not ride up
        // when the only way forward is BEGIN.
        <View style={{ minHeight: 44 }} />
      )}
      {label ? <Mono size={10} color={colors.mutedInk} letterSpacing={3} style={{ flexShrink: 1, textAlign: "right", marginLeft: 12 }}>{label}</Mono> : null}
    </View>
  );
}
