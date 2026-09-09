import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { Canvas, Rect, LinearGradient, vec } from "@shopify/react-native-skia";
import { colors } from "../theme";

type Insets = { top: number; left: number; right: number };

export function ReadingHeader({ children, inset, scrolled, onLayout }: {
  children: React.ReactNode; inset: Insets; scrolled: boolean; onLayout: (event: LayoutChangeEvent) => void;
}) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const [solid, setSolid] = useState(Platform.OS !== "ios");
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setSolid(value); });
    const listener = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setSolid);
    return () => { active = false; listener.remove(); };
  }, []);
  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: scrolled ? 1 : 0, duration: reducedMotion ? 0 : 140, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity, scrolled, reducedMotion]);
  return <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}
    onLayout={event => { setWidth(event.nativeEvent.layout.width); onLayout(event); }}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {solid ? <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite }]} /> : <>
        <BlurView tint="light" intensity={45} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
      </>}
      <Canvas style={{ position: "absolute", left: 0, right: 0, bottom: -16, height: 16 }}>
        <Rect x={0} y={0} width={width} height={16}>
          <LinearGradient start={vec(0, 0)} end={vec(0, 16)} colors={[colors.museumWhite, colors.museumWhiteClear]} />
        </Rect>
      </Canvas>
    </Animated.View>
    <View style={{ paddingTop: inset.top, paddingLeft: inset.left, paddingRight: inset.right }}>{children}</View>
  </View>;
}
