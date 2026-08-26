import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../theme";
import { Mono } from "./Text";

export function TopBar({ label }: { label?: string }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Return"
        hitSlop={8}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <Mono size={11} color={colors.goldDeep} letterSpacing={2}>‹ RETURN</Mono>
      </Pressable>
      {label ? <Mono size={10} color={colors.umber} letterSpacing={3}>{label}</Mono> : null}
    </View>
  );
}
