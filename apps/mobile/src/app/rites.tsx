import { View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton } from "../ui/Button";
import { numeral } from "../ui/CardChrome";
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
        {/* These are rules, so they are numbered — in the same carved
            numerals the card slots and the round's progress row use, so a
            rite and a call are visibly the same kind of thing (spec §6).
            Left-aligned: a numbered list that is centred is a poem. */}
        <View style={{ gap: space(3) }}>
          {RITES_LINES.map((line, i) => (
            <View key={line} style={{ flexDirection: "row", gap: space(3), alignItems: "flex-start" }}>
              <Ritual size={13} color={colors.goldText} letterSpacing={1} style={{ width: 26, textAlign: "right" }}>
                {numeral(i + 1)}
              </Ritual>
              <DecodeLine
                text={line}
                delayMs={i * 130}
                durationMs={450}
                size={11}
                color={colors.ink}
                letterSpacing={2}
                style={{ flex: 1, lineHeight: 18 }}
              />
            </View>
          ))}
        </View>
        <View style={{ gap: space(1), marginTop: space(2) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={10} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
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
