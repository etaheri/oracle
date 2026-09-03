import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { numeral } from "../ui/CardChrome";
import { RITES_LINES, OPENING_RITES_LINES, LITURGY_LINES } from "@oracle/core";
import { markRitesSeen } from "../api/flags";
import { colors, space } from "../theme";
import { useChromeScale } from "../ui/useChromeScale";

// The Rites: the rules of the game, machine voice, printed in once. Reached
// from a first-timer's ENTER (index.tsx gate) and a standing quiet link.
//
// Two readings of ONE canon. Before a first card the screen shows only the
// opening — what that card actually depends on, ending on the rite that names
// the goal. The standing link shows all thirteen. Twelve rules in one wall
// was ~150 words of tracked caps between install and the first card, and
// almost none of it survived the walk (audit 2026-09-02 §1.2); the rules that
// were cut are the ones the game teaches at the moment they apply — the way
// the floor rite already teaches the conviction floor.
export default function Rites() {
  const router = useRouter();
  // `?all=1` from the standing link; the first-timer gate arrives bare.
  const { all } = useLocalSearchParams<{ all?: string }>();
  const opening = all !== "1";
  const lines = opening ? OPENING_RITES_LINES : RITES_LINES;
  // The numeral gutter is a reserved slot like any other (spec §4). VIII and
  // XIII tie for the widest — four Cinzel glyphs at size 13 plus tracking is
  // ~34pt — so the slot is 40 at 1x and grows from there. It was 26, which
  // wrapped VIII onto a second line and knocked its rite out of alignment.
  const gutter = Math.ceil(40 * useChromeScale());
  return (
    <Screen>
      <TopBar showReturn={!opening} />
      {/* The full canon does not fit a phone. The screen used to centre it in a
          fixed box and rely on the count never growing — it was already at
          602pt of content in a 619pt box before the numerals arrived, and the
          gutter and its wider gaps pushed it 63pt past the edge, over BEGIN.
          A scroller that grows to fill centres them while they fit and scrolls
          once they do not, which is also the only thing that survives a reader
          who has turned their text size up. */}
      <ScrollView
        style={{ flex: 1 }}
        // No centring: the full canon always exceeds a phone, and centring
        // content taller than its container pushes the head of the list out
        // of the scrollable area — the eyebrow and rule I became unreachable.
        contentContainerStyle={{ flexGrow: 1, paddingVertical: space(4), gap: space(4) }}
        showsVerticalScrollIndicator={false}
      >
        <Eyebrow>{opening ? "The first rites" : "The rites"}</Eyebrow>
        {/* These are rules, so they are numbered — in the same carved
            numerals the card slots and the round's progress row use, so a
            rite and a call are visibly the same kind of thing (spec §6).
            Left-aligned: a numbered list that is centred is a poem. */}
        {/* The numerals hang in a left margin, so the text column needs that
            margin back on the right — otherwise the whole block sits off
            centre between a centred eyebrow and a centred liturgy, which is
            exactly how it read on device. Balanced, the column is centred and
            the numerals sit in the margin, the way a printed liturgy sets. */}
        <View style={{ gap: space(3), paddingRight: gutter + space(3) }}>
          {lines.map((line, i) => (
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
        {/* The deferred rules are not hidden, only held back: the opening
            says how many remain and where they are, so a player who wants
            the whole rulebook before their first card can have it. */}
        {opening && (
          <View style={{ alignItems: "center" }}>
            <QuietLink
              title={`The remaining ${RITES_LINES.length - OPENING_RITES_LINES.length} rites`}
              onPress={() => router.push({ pathname: "/rites", params: { all: "1" } })}
            />
          </View>
        )}
      </ScrollView>
      {/* BEGIN is a commitment and earns the gold. RETURN is not: the full
          canon is a reference, and TopBar's ‹ RETURN is pinned above the
          scroller and never leaves — a second, louder exit made the most
          emphatic element on the rulebook the way out of it. */}
      {opening && (
        <View style={{ paddingTop: space(3), paddingBottom: space(2) }}>
          <GoldButton
            title="BEGIN"
            onPress={() => { void markRitesSeen(); router.replace("/round"); }}
          />
        </View>
      )}
    </Screen>
  );
}
