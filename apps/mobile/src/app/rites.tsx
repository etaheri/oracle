import { ScrollView, View } from "react-native";
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
import { useChromeScale } from "../ui/useChromeScale";

// The Rites: the rules of the game, machine voice, printed in once. Reached
// from a first-timer's ENTER (index.tsx gate) and a standing quiet link.
export default function Rites() {
  const router = useRouter();
  // The numeral gutter is a reserved slot like any other (spec §4). VIII is
  // the widest of the twelve — four Cinzel glyphs at size 13 plus tracking is
  // ~34pt — so the slot is 40 at 1x and grows from there. It was 26, which
  // wrapped VIII onto a second line and knocked its rite out of alignment.
  const gutter = Math.ceil(40 * useChromeScale());
  return (
    <Screen>
      <TopBar />
      {/* Twelve rules do not fit a phone. The screen used to centre them in a
          fixed box and rely on the count never growing — it was already at
          602pt of content in a 619pt box before the numerals arrived, and the
          gutter and its wider gaps pushed it 63pt past the edge, over BEGIN.
          A scroller that grows to fill centres them while they fit and scrolls
          once they do not, which is also the only thing that survives a reader
          who has turned their text size up. */}
      <ScrollView
        style={{ flex: 1 }}
        // No centring: twelve rules always exceed a phone, and centring
        // content taller than its container pushes the head of the list out
        // of the scrollable area — the eyebrow and rule I became unreachable.
        contentContainerStyle={{ flexGrow: 1, paddingVertical: space(4), gap: space(4) }}
        showsVerticalScrollIndicator={false}
      >
        <Eyebrow>The rites</Eyebrow>
        {/* These are rules, so they are numbered — in the same carved
            numerals the card slots and the round's progress row use, so a
            rite and a call are visibly the same kind of thing (spec §6).
            Left-aligned: a numbered list that is centred is a poem. */}
        <View style={{ gap: space(3) }}>
          {RITES_LINES.map((line, i) => (
            <View key={line} style={{ flexDirection: "row", gap: space(3), alignItems: "flex-start" }}>
              <Ritual size={13} color={colors.goldText} letterSpacing={1} style={{ width: gutter, textAlign: "right" }}>
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
      </ScrollView>
      <View style={{ paddingTop: space(3), paddingBottom: space(2) }}>
        <GoldButton
          title="BEGIN"
          onPress={() => { void markRitesSeen(); router.replace("/round"); }}
        />
      </View>
    </Screen>
  );
}
