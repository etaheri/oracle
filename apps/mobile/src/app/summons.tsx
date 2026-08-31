import { View } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { SUMMONS_LINES } from "@oracle/core";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { colors, space } from "../theme";

export default function Summons() {
  const router = useRouter();
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The summons</Eyebrow>
        <View style={{ gap: space(2) }}>
          {SUMMONS_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} delayMs={i * 160} durationMs={450} size={12} color={colors.ink} letterSpacing={2} style={{ lineHeight: 20, textAlign: "center" }} />
          ))}
        </View>
      </View>
      <View style={{ gap: space(2), paddingBottom: space(2) }}>
        <GoldButton title="LET IT SPEAK" onPress={async () => { try { await Notifications.requestPermissionsAsync(); } catch {} leave(); }} />
        <QuietLink title="Not now" onPress={leave} />
      </View>
    </Screen>
  );
}
