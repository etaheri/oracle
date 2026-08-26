import { useEffect, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";
import { colors } from "../theme";
import { Ritual } from "./Text";

// Day points roll up to their final value before the haptic lands. JS-driven
// one-shot at ~30fps: Reanimated cannot animate Text content without a
// TextInput bridge, which a 700ms ceremony beat doesn't warrant.
export const ROLL_MS = 700;
const STEP_MS = 33;

export function RollingPoints({ value, delayMs }: { value: number; delayMs: number }) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) { setShown(value); return; }
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      const t0 = Date.now();
      id = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / ROLL_MS);
        const eased = 1 - Math.pow(1 - p, 4); // house easing, poly(4) out
        setShown(Math.round(value * eased));
        if (p >= 1 && id) clearInterval(id);
      }, STEP_MS);
    }, delayMs);
    return () => { clearTimeout(start); if (id) clearInterval(id); };
  }, [value, delayMs, reducedMotion]);

  const pos = value >= 0;
  return (
    <Ritual bold size={54} color={pos ? colors.goldText : colors.vermilion} letterSpacing={2}>
      {pos ? `+${shown}` : String(shown)}
    </Ritual>
  );
}
