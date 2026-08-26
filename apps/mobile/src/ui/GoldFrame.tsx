import { useState } from "react";
import { View, StyleSheet, type ViewProps } from "react-native";
import { Canvas, Rect, LinearGradient, vec, useClock } from "@shopify/react-native-skia";
import { useDerivedValue, useReducedMotion } from "react-native-reanimated";
import { colors } from "../theme";

const SWEEP_MS = 4200;

// Signature shader #2: gold-leaf shimmer — a slow band of brighter gold
// sweeping the frame, like leaf catching light. Ritual frames only.
export function GoldFrame({ children, style, ...rest }: ViewProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const clock = useClock();
  const reducedMotion = useReducedMotion();

  const positions = useDerivedValue(() => {
    const p = (clock.value % SWEEP_MS) / SWEEP_MS;
    return [Math.min(Math.max(p - 0.18, 0), 1), p, Math.min(Math.max(p + 0.18, 0), 1)];
  }, []);

  if (reducedMotion) {
    return <View {...rest} style={[{ borderWidth: 1, borderColor: colors.agedGold }, style]}>{children}</View>;
  }

  return (
    <View {...rest} style={style} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {children}
      {size.w > 0 && (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect x={0.5} y={0.5} width={size.w - 1} height={size.h - 1} style="stroke" strokeWidth={1}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(size.w, size.h)}
              colors={[colors.agedGold, colors.warmCenter, colors.agedGold]}
              positions={positions}
            />
          </Rect>
        </Canvas>
      )}
    </View>
  );
}
