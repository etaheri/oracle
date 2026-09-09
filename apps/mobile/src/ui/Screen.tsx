import { useState } from "react";
import { ReadingHeader } from "./ReadingHeader";
import { View, ScrollView, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, space } from "../theme";
import { Grain } from "./Grain";
import { AsciiField } from "./TerminalPatina";

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
export function Screen({ children, scroll = false, bleed = false, header, footer, overlayHeader = false, patina = false }: {
  children: React.ReactNode;
  scroll?: boolean;
  bleed?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  overlayHeader?: boolean;
  // Terminal Patina down the page's own margin. Opt-in, and only on reading
  // surfaces: the band is exactly the gutter the content is already padded
  // by, so a glyph can never land under a word. The brief asks for ASCII in
  // 20-30% of compositions at 5-20% coverage -- a two-column trickle at the
  // edge of a museum-white page is what "discovered as a detail" means when
  // the composition is a page of text rather than an artwork.
  patina?: boolean;
}) {
  const i = useScreenInset();
  const { height } = useWindowDimensions();
  const [headerHeight, setHeaderHeight] = useState(i.top + 44);
  const [scrolled, setScrolled] = useState(false);
  const overlay = scroll && overlayHeader && !!header;
  const padding = bleed ? {} : {
    paddingTop: overlay ? headerHeight : header ? 0 : i.top,
    paddingBottom: footer ? space(3) : i.bottom,
    paddingLeft: i.left, paddingRight: i.right,
  };
  return <View style={{ flex: 1, backgroundColor: colors.museumWhite }}>
    {patina && <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.6 }} pointerEvents="none">
      <AsciiField width={i.left} height={height} gate={0.12} />
    </View>}
    {header && !overlay && <View style={{ paddingTop: i.top, paddingLeft: i.left, paddingRight: i.right }}>{header}</View>}
    {scroll ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, ...padding }}
      contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
      alwaysBounceVertical={false} showsVerticalScrollIndicator
      scrollIndicatorInsets={overlay ? { top: headerHeight } : undefined}
      scrollEventThrottle={16} onScroll={overlay ? event => setScrolled(event.nativeEvent.contentOffset.y > 2) : undefined}>
      {children}
    </ScrollView> : <View style={{ flex: 1, minHeight: 0, ...padding }}>{children}</View>}
    {footer && <View style={{ paddingTop: space(3), paddingBottom: i.bottom, paddingLeft: i.left, paddingRight: i.right }}>{footer}</View>}
    {overlay && <ReadingHeader inset={i} scrolled={scrolled} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>{header}</ReadingHeader>}
    <Grain />
  </View>;
}
