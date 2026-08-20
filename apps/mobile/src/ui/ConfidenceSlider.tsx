import { useRef, useState } from "react";
import { View, PanResponder, LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, space } from "../theme";
import { Mono } from "./Text";
import { snapConfidence, confidenceReading } from "../game/confidence";

export function ConfidenceSlider({ value, onChange }: { value: number; onChange: (c: number) => void }) {
  const [width, setWidth] = useState(1);
  const valueRef = useRef(value);
  valueRef.current = value;
  const widthRef = useRef(1);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => update(e.nativeEvent.locationX),
      onPanResponderMove: (e) => update(e.nativeEvent.locationX),
    }),
  ).current;

  function update(x: number) {
    const next = snapConfidence(x / widthRef.current);
    if (next !== valueRef.current) {
      Haptics.selectionAsync();
      onChange(next);
    }
  }

  const ratio = (value - 55) / 40;
  return (
    <View style={{ gap: space(1.5) }}>
      <View
        {...pan.panHandlers}
        onLayout={(e: LayoutChangeEvent) => { setWidth(e.nativeEvent.layout.width); widthRef.current = e.nativeEvent.layout.width; }}
        style={{ height: 36, justifyContent: "center" }}
        accessibilityRole="adjustable"
        accessibilityLabel="Confidence"
        accessibilityValue={{ text: `${value} percent` }}
      >
        <View style={{ height: 2, backgroundColor: "rgba(233,225,205,0.10)" }}>
          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: ratio * width, backgroundColor: colors.gold }} />
        </View>
        <View style={{
          position: "absolute", left: Math.max(0, ratio * width - 8), width: 16, height: 16, borderRadius: 8,
          backgroundColor: colors.obsidian, borderWidth: 1.5, borderColor: colors.gold,
        }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {[55, 65, 75, 85, 95].map((t) => <Mono key={t} size={9} color={colors.ash}>{String(t)}</Mono>)}
      </View>
      <Mono size={11} color={colors.gold} letterSpacing={2} style={{ textAlign: "center" }}>
        {value}% · {confidenceReading(value)}
      </Mono>
    </View>
  );
}
