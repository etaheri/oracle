import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import { colors, space } from "../theme";
import { markBootDone } from "../game/bootGate";
import { DecodeLine } from "./DecodeText";
import { AsciiDust } from "./TerminalPatina";

// The boot rite: one short machine-voice ceremony on cold start, covering the
// app's first data fetch (brief §7 — "ASCII used for delight, loading,
// activation, and transitions"). It runs once per process, never on
// foreground, is tap-skippable, and under reduced motion never mounts at all
// — it must only ever occupy time the app would spend loading anyway, plus a
// minimum hold so it reads as intentional rather than as a flash.
// V2: lines print out of ASCII static with a cursor trailing the newest line,
// and a dim READY. closes the sequence — the classic micro-boot.
const LINES = ["ORACLE OS V1.0", "THE ORB WAKES", "THE LEDGER OPENS"] as const;
const LINE_MS = 420;
const READY_MS = LINES.length * LINE_MS + 320;
const HOLD_MS = READY_MS + 700;
const FADE_MS = 450;

export function BootRite() {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(1);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (reducedMotion) { markBootDone(); return; }
    const timers = LINES.slice(1).map((_, i) =>
      setTimeout(() => setShown(i + 2), (i + 1) * LINE_MS),
    );
    timers.push(setTimeout(() => setReady(true), READY_MS));
    timers.push(setTimeout(() => setDone(true), HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  useEffect(() => {
    if (done) markBootDone();
  }, [done]);

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
            <DecodeLine
              key={line}
              text={line}
              cursor={!ready && i === shown - 1}
              durationMs={340}
              size={11}
              color={i === 0 ? colors.goldText : colors.mutedInk}
              letterSpacing={3}
            />
          ))}
          {ready && (
            <Animated.View entering={FadeIn.duration(200)}>
              <DecodeLine text="READY." cursor durationMs={200} size={11} color={colors.goldText} letterSpacing={3} />
            </Animated.View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}
