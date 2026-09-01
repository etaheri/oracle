import { useEffect } from "react";
import { Image } from "expo-image";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { handOffscreenX, type Rect } from "../game/heroStage";

// One hand slot. Placeholder behavior: the idle loop slides in from its own
// edge when `enter` flips true. With real entrance clips (loop count 1) the
// slide collapses to 0ms and the clip's own motion carries the entrance —
// the prop contract stays the same.
const SOURCES = {
  left: require("../../assets/art/hand-left-loop.webp"),
  right: require("../../assets/art/hand-right-loop.webp"),
} as const;

export const HAND_ENTER_MS = 700;

export function HandLayer({
  rect,
  side,
  enter,
  stageWidth,
  delayMs = 0,
}: {
  rect: Rect;
  side: "left" | "right";
  enter: boolean;
  stageWidth: number;
  delayMs?: number;
}) {
  const off = handOffscreenX(stageWidth, side);
  const tx = useSharedValue(enter ? 0 : off);

  useEffect(() => {
    if (enter) tx.value = withDelay(delayMs, withTiming(0, { duration: HAND_ENTER_MS, easing: Easing.out(Easing.cubic) }));
  }, [enter, delayMs, tx]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <Animated.View style={[{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }, style]} pointerEvents="none">
      <Image source={SOURCES[side]} contentFit="contain" style={{ width: rect.w, height: rect.h }} accessible={false} />
    </Animated.View>
  );
}
