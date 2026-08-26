import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import { colors, space } from "../theme";
import { Mono } from "./Text";
import { AsciiDust } from "./TerminalPatina";

// The boot rite: one short machine-voice ceremony on cold start, covering the
// app's first data fetch (brief §7 — "ASCII used for delight, loading,
// activation, and transitions"). It runs once per process, never on
// foreground, is tap-skippable, and under reduced motion never mounts at all
// — it must only ever occupy time the app would spend loading anyway, plus a
// minimum hold so it reads as intentional rather than as a flash.
const LINES = ["ORACLE OS V1.0", "THE ORB WAKES", "THE LEDGER OPENS"] as const;
const LINE_MS = 420;
const HOLD_MS = 1650;
const FADE_MS = 450;

export function BootRite() {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(1);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    const timers = LINES.slice(1).map((_, i) =>
      setTimeout(() => setShown(i + 2), (i + 1) * LINE_MS),
    );
    timers.push(setTimeout(() => setDone(true), HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  if (reducedMotion || done) return null;
  return (
    <Animated.View exiting={FadeOut.duration(FADE_MS)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite, zIndex: 100 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip introduction"
        onPress={() => setDone(true)}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(4) }}
      >
        <AsciiDust size={160} />
        <View style={{ gap: space(2), alignItems: "center" }}>
          {LINES.slice(0, shown).map((line, i) => (
            <Animated.View key={line} entering={FadeIn.duration(260)}>
              <Mono size={11} color={i === 0 ? colors.goldText : colors.mutedInk} letterSpacing={3}>
                {line}
              </Mono>
            </Animated.View>
          ))}
        </View>
      </Pressable>
    </Animated.View>
  );
}
