import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors } from "../theme";
import { Ritual } from "./Text";

export const STAMP_MS = 240;

// The wax seal: a gold roundel bearing the card's numeral, stamped onto the
// card face the moment the prophecy is sealed. Lives on the front face only,
// so it rides along into the flip.
export function SealStamp({ numeral }: { numeral: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: STAMP_MS, easing: Easing.out(Easing.poly(4)) });
  }, [p]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: 1.6 - 0.6 * p.value }, { rotate: "-8deg" }],
  }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View
        style={[
          {
            width: 92,
            height: 92,
            borderRadius: 46,
            borderWidth: 2,
            borderColor: colors.agedGold,
            backgroundColor: colors.goldWash,
            alignItems: "center",
            justifyContent: "center",
          },
          style,
        ]}
      >
        <View style={{ position: "absolute", top: 5, bottom: 5, left: 5, right: 5, borderRadius: 41, borderWidth: 1, borderColor: colors.agedGold }} />
        <Ritual bold size={30} letterSpacing={0}>{numeral}</Ritual>
      </Animated.View>
    </View>
  );
}
