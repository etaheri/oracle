import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, space } from "../theme";
import { getHeroAnchor, markBootDone, markOrbLanded } from "../game/bootGate";
import { dustRect, orbRect } from "../game/heroStage";
import { DecodeLine } from "./DecodeText";
import { AsciiDust, GOLD } from "./TerminalPatina";
import { OracleOrb } from "./orb/OracleOrb";

// The boot rite: one short machine-voice ceremony on cold start, covering the
// app's first data fetch (brief §7 — "ASCII used for delight, loading,
// activation, and transitions"). It runs once per process, never on
// foreground, is tap-skippable, and under reduced motion never mounts at all
// — it must only ever occupy time the app would spend loading anyway, plus a
// minimum hold so it reads as intentional rather than as a flash.
// V3 (spec 2026-09-01-boot-orb-handoff): the orb is here from the first frame
// as a still, with its dust ring, at exactly the size it has on Home. When the
// hold elapses the field fades and the orb rises to Home's measured slot, its
// own dust ring dissolving in flight so it never overlaps Home's dimmer one;
// on landing, Home's orb takes over in its waking state — THE ORB WAKES. With no
// anchor (deep link, unmeasured) the whole orb+dust group fades out together
// with the field instead of sliding.
const LINES = ["OUTSEEN", "THE ORACLE WAKES", "YOUR NEXT CALL AWAITS"] as const;
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
  const dustBox = dustRect(width);
  const groupRef = useRef<View>(null);
  // The print-sequence timers (line reveals, READY, done). Held in a ref so
  // the `done` effect can cancel them the instant it fires — a skip tap
  // otherwise leaves them running, and a later setShown/setReady still
  // landing mid-slide grows the (opacity-only, still-in-layout) text column
  // and shoves the centered group off the position dx/dy were measured from.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const field = useSharedValue(1);
  const text = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const groupOpacity = useSharedValue(1);
  const dust = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) { markBootDone(); markOrbLanded(); return; }
    timers.current = LINES.slice(1).map((_, i) =>
      setTimeout(() => setShown(i + 2), (i + 1) * LINE_MS),
    );
    timers.current.push(setTimeout(() => setReady(true), READY_MS));
    timers.current.push(setTimeout(() => setDone(true), HOLD_MS));
    return () => timers.current.forEach(clearTimeout);
  }, [reducedMotion]);

  useEffect(() => {
    if (!done || gone) return;
    // Freeze the print sequence the instant done fires — no further
    // setShown/setReady may land and reflow the text column mid-slide.
    timers.current.forEach(clearTimeout);
    timers.current = [];
    markBootDone();
    const finish = () => { markOrbLanded(); setGone(true); };
    field.value = withTiming(0, { duration: FADE_MS, easing: Easing.out(Easing.quad) });
    text.value = withTiming(0, { duration: TEXT_FADE_MS });

    const anchor = getHeroAnchor();
    const group = groupRef.current;
    if (!anchor || !group) {
      // No slide possible: fade the orb+dust group out together with the
      // field, then hand off — otherwise an opaque orb and gold dust ring
      // would sit exposed once the field dissolves to reveal what's beneath.
      groupOpacity.value = withTiming(0, { duration: FADE_MS });
      const id = setTimeout(finish, FADE_MS);
      return () => clearTimeout(id);
    }
    // The group is the dust canvas with the orb centered inside it, so the
    // group's center IS the orb's center; the anchor is the orb tile's rect.
    // The boot dust dissolves over the slide so it doesn't sit on top of
    // Home's own (dimmer, lavender) dust ring once the field turns
    // transparent; the orb itself stays fully opaque throughout. A watchdog
    // stands in for `finish` if the native measure/animation callback never
    // arrives — finish is idempotent and setGone after unmount is a no-op.
    dust.value = withTiming(0, { duration: SLIDE_MS });
    const id = setTimeout(finish, SLIDE_MS + 150);
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
    return () => clearTimeout(id);
  }, [done, gone, field, text, tx, ty, groupOpacity, dust]);

  const fieldStyle = useAnimatedStyle(() => ({ opacity: field.value }));
  const textStyle = useAnimatedStyle(() => ({ opacity: text.value }));
  const groupStyle = useAnimatedStyle(() => ({
    opacity: groupOpacity.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));
  const dustStyle = useAnimatedStyle(() => ({ opacity: dust.value }));

  if (reducedMotion || gone) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]} pointerEvents={done ? "none" : "auto"}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite }, fieldStyle]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip introduction"
        onPress={() => setDone(true)}
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
      >
        <Animated.View ref={groupRef} style={[{ width: dustBox.w, height: dustBox.h }, groupStyle]}>
          <Animated.View style={[StyleSheet.absoluteFill, dustStyle]} pointerEvents="none">
            <AsciiDust size={dustBox.w} color={GOLD} intensity={0.7} gate={0.28} />
          </Animated.View>
          <View style={{ position: "absolute", left: (dustBox.w - orb.w) / 2, top: (dustBox.h - orb.h) / 2 }}>
            <OracleOrb tile={orb.w} state="dormant" />
          </View>
        </Animated.View>
        {/* Out of flow, hung from the screen's midline: each printed line grows
            this column, and in flow that growth re-centered the pair and walked
            the orb upward line by line. The orb must hold still — it is about to
            be measured against Home's slot. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              marginTop: dustBox.h / 2 + space(4),
              gap: space(2),
              alignItems: "center",
            },
            textStyle,
          ]}
        >
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
