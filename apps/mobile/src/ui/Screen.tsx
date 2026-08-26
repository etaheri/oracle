import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "../theme";
import { Grain } from "./Grain";

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.parchment }}>
      <View style={{ flex: 1, padding: space(5) }}>{children}</View>
      <Grain />
    </SafeAreaView>
  );
}
