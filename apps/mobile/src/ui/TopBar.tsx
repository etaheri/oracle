import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../theme";
import { Mono, role } from "./Text";

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
          <Mono {...role.line} color={colors.goldText} style={[role.line.style, { textAlign: "left" }]}>‹ RETURN</Mono>
        </Pressable>
      ) : (
        // The gate keeps its 44pt bar so the eyebrow below does not ride up
        // when the only way forward is BEGIN.
        <View style={{ minHeight: 44 }} />
      )}
      {label ? <Mono {...role.meta} color={colors.mutedInk} style={{ flexShrink: 1, textAlign: "right", marginLeft: 12 }}>{label}</Mono> : null}
    </View>
  );
}
