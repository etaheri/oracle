import { View } from "react-native";
import { CardChrome } from "./CardChrome";
import { Mono } from "./Text";
import { decodeFrame } from "../game/terminalPrint";
import { colors } from "../theme";
import type { RoundToday } from "@oracle/core";

// A card still in the deck: real chrome, unmaterialized prophecy. Category
// and question print as pure static (decodeFrame step 0 — symbols only, word
// shape preserved), so the stack shows true depth without spoiling a card
// that has not been dealt. Never interactive.
export function UndealtCard({ q, index }: { q: RoundToday["questions"][number]; index: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 9 + index * 9,
        transform: [{ rotate: index === 0 ? "-0.7deg" : "0.9deg" }],
      }}
    >
      <CardChrome slot={q.slot} title={decodeFrame(q.category, 0, 1, q.id)} big={q.is_big_one}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Mono size={13} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center", lineHeight: 24 }}>
            {decodeFrame(q.text, 0, 1, q.id)}
          </Mono>
        </View>
      </CardChrome>
    </View>
  );
}
