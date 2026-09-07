import { View, ScrollView } from "react-native";
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

// The margin, for a screen that pays it itself. A screen driving its own
// scroller (the reveal) cannot use `scroll` below — it owns a RefreshControl,
// scroll measurement and a fold fade — but it wants the same bleed, so it
// takes the numbers and spends them on its own content box.
export function useScreenInset() {
  const insets = useSafeAreaInsets();
  return {
    top: Math.max(insets.top, GUTTER),
    bottom: Math.max(insets.bottom, GUTTER),
    left: Math.max(insets.left, GUTTER),
    right: Math.max(insets.right, GUTTER),
  };
}

// Header and footer own their safe edges; the body pays only the remaining ones.
export function Screen({ children, scroll = false, bleed = false, header, footer }: {
  children: React.ReactNode;
  scroll?: boolean;
  bleed?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const i = useScreenInset();
  const padding = bleed ? {} : {
    paddingTop: header ? 0 : i.top,
    paddingBottom: footer ? space(3) : i.bottom,
    paddingLeft: i.left, paddingRight: i.right,
  };
  return <View style={{ flex: 1, backgroundColor: colors.museumWhite }}>
    {header && <View style={{ paddingTop: i.top, paddingLeft: i.left, paddingRight: i.right }}>{header}</View>}
    {scroll ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, ...padding }}
      contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
      alwaysBounceVertical={false} showsVerticalScrollIndicator>
      {children}
    </ScrollView> : <View style={{ flex: 1, minHeight: 0, ...padding }}>{children}</View>}
    {footer && <View style={{ paddingTop: space(3), paddingBottom: i.bottom, paddingLeft: i.left, paddingRight: i.right }}>{footer}</View>}
    <Grain />
  </View>;
}
