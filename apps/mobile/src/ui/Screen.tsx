import { SafeAreaView, View } from "react-native";
import { colors, space } from "../theme";

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.obsidian }}>
      <View style={{ flex: 1, padding: space(5) }}>{children}</View>
    </SafeAreaView>
  );
}
