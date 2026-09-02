import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, space } from "../theme";
import { Grain } from "./Grain";

// The device's safe inset and the design's gutter are the same margin, not two
// stacked ones. `SafeAreaView` insets its children by the full safe area and
// the inner view then added space(5) on top of that, so on a notched phone the
// first pixel of every screen sat 79pt down and the last 54pt up — 40pt of
// composition spent twice, on the screens that could least afford it.
//
// Compose them instead: take whichever is larger. A notched phone clears its
// notch and nothing more; a flat one still gets a real margin. The ground and
// its grain now run edge to edge behind the insets rather than stopping at
// them, which is what a museum wall does.
const GUTTER = space(5);

export function Screen({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.museumWhite }}>
      <View
        style={{
          flex: 1,
          paddingTop: Math.max(insets.top, GUTTER),
          paddingBottom: Math.max(insets.bottom, GUTTER),
          paddingLeft: Math.max(insets.left, GUTTER),
          paddingRight: Math.max(insets.right, GUTTER),
        }}
      >
        {children}
      </View>
      <Grain />
    </View>
  );
}
