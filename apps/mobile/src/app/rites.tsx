import { View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton } from "../ui/Button";
import { RITES_LINES, LITURGY_LINES } from "@oracle/core";
import { markRitesSeen } from "../api/flags";
import { colors, space } from "../theme";

// The Rites: the rules of the game, machine voice, printed in once. Reached
// from a first-timer's ENTER (index.tsx gate) and a standing quiet link.
export default function Rites() {
  const router = useRouter();
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The rites</Eyebrow>
        <View style={{ gap: space(2) }}>
          {RITES_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} delayMs={i * 130} durationMs={450} size={11} color={colors.ink} letterSpacing={2} style={{ lineHeight: 18 }} />
          ))}
        </View>
        <View style={{ gap: space(1), marginTop: space(2) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={9} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </View>
      </View>
      <View style={{ paddingBottom: space(2) }}>
        <GoldButton
          title="BEGIN"
          onPress={() => { void markRitesSeen(); router.replace("/round"); }}
        />
      </View>
    </Screen>
  );
}
