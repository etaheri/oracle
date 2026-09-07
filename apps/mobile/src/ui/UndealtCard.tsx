import { View } from "react-native";
import { CardChrome } from "./CardChrome";
import { Serif } from "./Text";
import { QUESTION_FACE } from "./OracleCard";
import { decodeFrame } from "../game/terminalPrint";
import { colors } from "../theme";
import type { RoundToday } from "@oracle/core";

// A card still in the deck: real chrome, unmaterialized prophecy. Category
// and question print as pure static (decodeFrame step 0 — symbols only, word
// shape preserved), so the stack shows true depth without spoiling a card
// that has not been dealt. Never interactive.
//
// The top of the stack's resting pose is exported so the live card can take
// over from EXACTLY here when the thrown card uncovers it — the stack card
// and the live card must read as the same object.
export const STACK_TOP_Y = 16;
export const STACK_TOP_ROTATE = "-0.7deg";

export function UndealtCard({ q, index, height }: { q: RoundToday["questions"][number]; index: number; height?: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: STACK_TOP_Y + index * 14,
        transform: [{ rotate: index === 0 ? STACK_TOP_ROTATE : "0.9deg" }],
      }}
    >
      <CardChrome height={height} slot={q.slot} title={decodeFrame(q.category, 0, 1, q.id)} big={q.is_big_one}>
        <View style={{ flex: 1, overflow: "hidden", justifyContent: "center" }}>
          {/* Same face, size, seed and tone as the live card's unresolved
              inscription — so uncovering it changes nothing but time. */}
          <Serif size={QUESTION_FACE.size} color={colors.mutedInk} style={{ textAlign: "center", lineHeight: QUESTION_FACE.lineHeight }}>
            {decodeFrame(q.text, 0, 1, q.id)}
          </Serif>
        </View>
      </CardChrome>
    </View>
  );
}
