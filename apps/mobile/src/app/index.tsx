import { View } from "react-native";
import { Screen } from "../ui/Screen";
import { Serif, Eyebrow } from "../ui/Text";

export default function Index() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Eyebrow>Oracle OS v1.0</Eyebrow>
        <Serif size={40} style={{ marginTop: 24 }}>ORACLE</Serif>
      </View>
    </Screen>
  );
}
