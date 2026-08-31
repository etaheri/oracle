import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { CALLING_LINES } from "@oracle/core";
import { colors, space } from "../theme";
import { markBootDone } from "../game/bootGate";
import { markCallingSeen } from "../api/flags";
import { callingHaptic } from "../game/calling";
import { DecodeLine } from "./DecodeText";
import { AsciiDust } from "./TerminalPatina";

// The Calling: the app's very first breath — the machine recounts the search
// and assigns the player their role. Cinema, not a gate: no button, each beat
// lands in the hand, the last one is for the player, then home resolves
// underneath. Runs once ever (oracle.calling_seen); every later cold start
// gets the plain BootRite. Tap anywhere skips.
const BEAT_MS = 2400; // one beat: print (~900ms) + hold
const PRINT_MS = 900;
const FINAL_HOLD_MS = 2000;
const FADE_MS = 600;

export function CallingRite() {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(1);
  const [done, setDone] = useState(false);

  // The score: beat i starts printing at i·BEAT, lands (haptic) at
  // i·BEAT + PRINT. After the final beat holds, the fade begins.
  useEffect(() => {
    if (reducedMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    CALLING_LINES.forEach((_, i) => {
      if (i > 0) timers.push(setTimeout(() => setShown(i + 1), i * BEAT_MS));
      timers.push(
        setTimeout(() => {
          void Haptics.impactAsync(
            callingHaptic(i, CALLING_LINES.length) === "heavy"
              ? Haptics.ImpactFeedbackStyle.Heavy
              : Haptics.ImpactFeedbackStyle.Light,
          );
        }, i * BEAT_MS + PRINT_MS),
      );
    });
    timers.push(
      setTimeout(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setDone(true);
      }, (CALLING_LINES.length - 1) * BEAT_MS + PRINT_MS + FINAL_HOLD_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  useEffect(() => {
    if (done) {
      void markCallingSeen();
      markBootDone();
    }
  }, [done]);

  if (done) return null;

  const last = CALLING_LINES.length - 1;

  // Reduced motion: the story still told, once — statically, no haptics,
  // a quiet continue in place of the cinematic clock.
  if (reducedMotion) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.field]}>
        <View style={styles.column}>
          {CALLING_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} durationMs={0} size={11} color={i === last ? colors.goldText : colors.mutedInk} letterSpacing={2} style={styles.line} />
          ))}
          <Pressable accessibilityRole="button" onPress={() => setDone(true)} style={{ marginTop: space(4) }}>
            <DecodeLine text="CONTINUE" durationMs={0} size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Animated.View exiting={FadeOut.duration(FADE_MS)} style={[StyleSheet.absoluteFill, styles.field]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip introduction"
        onPress={() => setDone(true)}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(5) }}
      >
        <AsciiDust size={160} />
        <View style={styles.column}>
          {CALLING_LINES.slice(0, shown).map((line, i) => (
            <Animated.View key={line} entering={FadeIn.duration(200)}>
              <DecodeLine
                text={line}
                cursor={i === shown - 1 && i !== last}
                durationMs={PRINT_MS}
                size={11}
                color={i === last ? colors.goldText : colors.mutedInk}
                letterSpacing={2}
                style={styles.line}
              />
            </Animated.View>
          ))}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  field: { backgroundColor: colors.museumWhite, zIndex: 100, justifyContent: "center" },
  column: { gap: space(2), alignItems: "center", paddingHorizontal: space(4) },
  line: { lineHeight: 18, textAlign: "center" },
});
