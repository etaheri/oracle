import { useEffect, useState } from "react";
import { Text, type TextProps } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { colors } from "../theme";
import { Mono } from "./Text";
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
  return (
    <Mono size={size} color={color} letterSpacing={letterSpacing} style={style} {...rest}>
      {shown}
      {cursor && (
        <Text style={{ color: blinkOn || reducedMotion ? (color ?? colors.mutedInk) : "transparent" }}>_</Text>
      )}
    </Mono>
  );
}
