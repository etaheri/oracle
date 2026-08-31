import { useEffect, useState } from "react";
import { Text, type TextProps } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { colors } from "../theme";
import { Mono, Serif } from "./Text";
import { decodeFrame } from "../game/terminalPrint";

// The machine prints its lines: characters resolve left-to-right out of ASCII
// static, quantized to steps (never per-frame randomization). Reduced motion
// renders the final text immediately and holds the cursor steady.
const STEP_MS = 50;
const BLINK_MS = 530;

export function DecodeLine({
  text,
  seed,
  durationMs = 400,
  delayMs = 0,
  cursor = false,
  active = true,
  serif = false,
  dimColor,
  size,
  color,
  letterSpacing,
  style,
  ...rest
}: Omit<TextProps, "children"> & {
  text: string;
  seed?: string;
  durationMs?: number;
  delayMs?: number;
  cursor?: boolean;
  // While false the line holds as static (full noise) and the print does not
  // start — home uses this to wait out the boot-rite overlay.
  active?: boolean;
  // Print in the card's serif instead of the machine's mono — the artifact's
  // own text resolving in its own face, no typeface flip at the end.
  serif?: boolean;
  // Two-tone print: the unresolved static wears this color, the resolved
  // characters wear `color`. Omit for a single-tone line.
  dimColor?: string;
  size?: number;
  color?: string;
  letterSpacing?: number;
}) {
  const reducedMotion = useReducedMotion();
  const totalSteps = Math.max(1, Math.round(durationMs / STEP_MS));
  const [step, setStep] = useState(reducedMotion ? totalSteps : 0);
  const [blinkOn, setBlinkOn] = useState(true);

  useEffect(() => {
    if (reducedMotion) { setStep(totalSteps); return; }
    setStep(0);
    if (!active) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      id = setInterval(() => {
        setStep((s) => {
          if (s + 1 >= totalSteps && id) clearInterval(id);
          return s + 1;
        });
      }, STEP_MS);
    }, delayMs);
    return () => { clearTimeout(start); if (id) clearInterval(id); };
  }, [text, reducedMotion, totalSteps, delayMs, active]);

  useEffect(() => {
    if (!cursor || reducedMotion) return;
    const id = setInterval(() => setBlinkOn((b) => !b), BLINK_MS);
    return () => clearInterval(id);
  }, [cursor, reducedMotion]);

  const shown = decodeFrame(text, step, totalSteps, seed ?? text);
  // Same split decodeFrame uses, so the tone boundary sits exactly on the
  // resolved/unresolved seam.
  const revealed = step >= totalSteps ? text.length : Math.floor((text.length * Math.max(0, step)) / totalSteps);
  const Face = serif ? Serif : Mono;
  return (
    <Face size={size} color={color} {...(serif ? {} : { letterSpacing })} style={style} {...rest}>
      {dimColor ? shown.slice(0, revealed) : shown}
      {dimColor && <Text style={{ color: dimColor }}>{shown.slice(revealed)}</Text>}
      {cursor && (
        <Text style={{ color: blinkOn || reducedMotion ? (color ?? colors.mutedInk) : "transparent" }}>_</Text>
      )}
    </Face>
  );
}
