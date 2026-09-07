import { useState } from "react";
import { View } from "react-native";

// Keep the deck's proportion when it fits, and reserve room for its stack.
export function CardStage({ children, stack = 0 }: {
  children: (height: number | undefined) => React.ReactNode;
  stack?: number;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const height = size.height > 0 ? Math.max(1, Math.min(size.width / 0.7, size.height - stack)) : undefined;
  return <View style={{ flex: 1, minHeight: 0, justifyContent: "center", paddingBottom: stack }}
    onLayout={({ nativeEvent: { layout } }) => setSize(previous => previous.width === layout.width && previous.height === layout.height ? previous : layout)}>
    {children(height)}
  </View>;
}
