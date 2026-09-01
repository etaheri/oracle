import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, space } from "../theme";
import { getHeroAnchor, markBootDone, markOrbLanded } from "../game/bootGate";
import { dustRect, orbRect } from "../game/heroStage";
import { DecodeLine } from "./DecodeText";
import { AsciiDust, GOLD } from "./TerminalPatina";
import { OrbLayer } from "./OrbLayer";

// The boot rite: one short machine-voice ceremony on cold start, covering the
// app's first data fetch (brief §7 — "ASCII used for delight, loading,
// activation, and transitions"). It runs once per process, never on
// foreground, is tap-skippable, and under reduced motion never mounts at all
// — it must only ever occupy time the app would spend loading anyway, plus a
// minimum hold so it reads as intentional rather than as a flash.
// V3 (spec 2026-09-01-boot-orb-handoff): the orb is here from the first frame
// as a still, with its dust ring, at exactly the size it has on Home. When the
// hold elapses the field fades and the orb rises to Home's measured slot; on
// landing Home's own orb takes over on frame 0 — THE ORB WAKES. With no
// anchor (deep link, unmeasured) the rite simply fades as before.
const LINES = ["ORACLE OS V1.0", "THE ORB WAKES", "THE LEDGER OPENS"] as const;
const LINE_MS = 420;
const READY_MS = LINES.length * LINE_MS + 320;
const HOLD_MS = READY_MS + 700;
const FADE_MS = 450;
const TEXT_FADE_MS = 200;
const SLIDE_MS = 550;

export function BootRite() {
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const [shown, setShown] = useState(1);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);

  // Geometry shared with Home: identical rects from the same window width, so
  // the slide is pure translation.
  const orb = orbRect(width);
  const dust = dustRect(width);
  const groupRef = useRef<View>(null);

  const field = useSharedValue(1);
  const text = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) { markBootDone(); markOrbLanded(); return; }
    const timers = LINES.slice(1).map((_, i) =>
      setTimeout(() => setShown(i + 2), (i + 1) * LINE_MS),
    );
    timers.push(setTimeout(() => setReady(true), READY_MS));
    timers.push(setTimeout(() => setDone(true), HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  useEffect(() => {
    if (!done || gone) return;
    markBootDone();
    const finish = () => { markOrbLanded(); setGone(true); };
    field.value = withTiming(0, { duration: FADE_MS, easing: Easing.out(Easing.quad) });
    text.value = withTiming(0, { duration: TEXT_FADE_MS });

    const anchor = getHeroAnchor();
    const group = groupRef.current;
    if (!anchor || !group) {
      // No slide possible: fade as V2 did, then hand off.
      const id = setTimeout(finish, FADE_MS);
      return () => clearTimeout(id);
    }
    // The group is the dust canvas with the orb centered inside it, so the
    // group's center IS the orb's center; the anchor is the orb tile's rect.
    group.measureInWindow((gx, gy, gw, gh) => {
      const dx = anchor.x + anchor.w / 2 - (gx + gw / 2);
      const dy = anchor.y + anchor.h / 2 - (gy + gh / 2);
      const cfg = { duration: SLIDE_MS, easing: Easing.out(Easing.cubic) };
      tx.value = withTiming(dx, cfg);
      ty.value = withTiming(dy, cfg, (finished) => {
        "worklet";
        if (finished) runOnJS(finish)();
      });
    });
  }, [done, gone, field, text, tx, ty]);

  const fieldStyle = useAnimatedStyle(() => ({ opacity: field.value }));
  const textStyle = useAnimatedStyle(() => ({ opacity: text.value }));
  const groupStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }] }));

  if (reducedMotion || gone) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]} pointerEvents={done ? "none" : "auto"}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite }, fieldStyle]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip introduction"
        onPress={() => setDone(true)}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(4) }}
      >
        <Animated.View ref={groupRef} style={[{ width: dust.w, height: dust.h }, groupStyle]}>
          <AsciiDust size={dust.w} color={GOLD} intensity={0.7} gate={0.28} />
          <OrbLayer rect={{ x: (dust.w - orb.w) / 2, y: (dust.h - orb.h) / 2, w: orb.w, h: orb.h }} playing={false} />
        </Animated.View>
        <Animated.View style={[{ gap: space(2), alignItems: "center" }, textStyle]}>
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
        </Animated.View>
      </Pressable>
    </View>
  );
}
