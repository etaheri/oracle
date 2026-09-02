import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { blinkFrame } from "../game/terminalPrint";
import { Mono } from "./Text";
import { colors, space } from "../theme";

// The conviction column: a glyph thermometer pinned to the screen edge the
// player is pulling toward — stationary while the card moves underneath.
// Machine voice throughout (a gauge is chrome, not scripture). Nine cells,
// one per conviction step, and the column PRINTS: cells land one per tick
// (never sliding), each new cell flashing one frame of noise before its '#',
// and the percentage passes through one noise frame on every step change —
// the same decode idiom as every other readout in the app.
//
// conf === null is the live-but-uncommitted pull: the column stands as
// unresolved static — muted, unlit, the percentage still noise — and snaps
// into the side's tone the moment 55% resolves at the commit thunk.
const CELLS = 9;
const PRINT_TICK_MS = 45;

// Steps `shown` toward `target` one cell per tick — the print cadence.
// Reduced motion resolves instantly.
function usePrintedCells(target: number, instant: boolean): number {
  const [shown, setShown] = useState(instant ? target : 0);
  useEffect(() => {
    if (instant) { setShown(target); return; }
    const id = setInterval(() => {
      setShown((s) => {
        if (s === target) { clearInterval(id); return s; }
        return s + Math.sign(target - s);
      });
    }, PRINT_TICK_MS);
    return () => clearInterval(id);
  }, [target, instant]);
  return shown;
}

// One blink frame on change, then the true value — but only the characters
// that changed pass through noise (70→75 blinks the 5, never the 7).
function useDecodeBlink(text: string, instant: boolean): string {
  const [frame, setFrame] = useState<string | null>(null);
  const prev = useRef(text);
  useEffect(() => {
    const was = prev.current;
    prev.current = text;
    if (instant || was === text) return;
    setFrame(blinkFrame(was, text, "col"));
    const id = setTimeout(() => setFrame(null), PRINT_TICK_MS);
    return () => clearTimeout(id);
  }, [text, instant]);
  return frame ?? text;
}

export function ConvictionColumn({ conf, side }: { conf: number | null; side: boolean }) {
  const reducedMotion = useReducedMotion();
  const committed = conf !== null;
  const tone = committed ? (side ? colors.ultramarine : colors.vermilion) : colors.mutedInk;
  const target = committed ? (conf - 55) / 5 + 1 : 0; // 1..9 once committed
  const printed = usePrintedCells(target, reducedMotion);
  const pctText = useDecodeBlink(committed ? `${conf}%` : "··%", reducedMotion);
  return (
    <View
      pointerEvents="none"
      // Chrome, not content: the rapid print churn would spam a screen
      // reader, and its information already reaches SR players through the
      // hold ticks and the footer reading.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        ...(side ? { right: space(2) } : { left: space(2) }),
        justifyContent: "center",
        alignItems: "center",
        gap: space(2),
        zIndex: 10,
        opacity: committed ? 1 : 0.6,
      }}
    >
      <Mono size={10} color={tone} letterSpacing={2} style={{ marginRight: -2 }}>{side ? "YES" : "NO"}</Mono>
      {/* Regular-weight mono, instrument-sized: a readout, not a headline. */}
      <Mono size={14} color={tone} letterSpacing={1}>{pctText}</Mono>
      {/* The scale endpoints make this read as a calibrated instrument, not
          a fill bar: belief runs 55 (the least lean that says anything) to
          95 (no certainty before the ledger). The floor is the ante. */}
      <View style={{ alignItems: "center", gap: 3 }}>
        {/* The ceiling lights when you reach it: belief stops at 95, and the
            column is the only thing that can say so while the card is moving. */}
        <Mono size={8} color={conf === 95 ? tone : colors.mutedInk}>95</Mono>
        <View style={{ borderWidth: 1, borderColor: committed ? tone : colors.line, backgroundColor: colors.frescoWhite, paddingVertical: 5, paddingHorizontal: 6, gap: 2, alignItems: "center" }}>
          {Array.from({ length: CELLS }, (_, i) => CELLS - 1 - i).map((row) => {
            const lit = row < printed;
            // The freshest cell wears one frame of noise before settling to '#'.
            const fresh = lit && row === printed - 1 && printed !== target;
            return (
              <Mono key={row} size={13} color={lit ? tone : colors.line} style={{ lineHeight: 15 }}>
                {fresh ? "%" : lit ? "#" : "·"}
              </Mono>
            );
          })}
        </View>
        <Mono size={8} color={colors.mutedInk}>55</Mono>
      </View>
    </View>
  );
}
