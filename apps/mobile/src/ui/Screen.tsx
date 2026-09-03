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

// `scroll` moves the margin off the container and onto the CONTENT.
//
// A padded container clips its scroller at the safe area, so the last row of a
// long screen stops a gutter short of the glass and the page ends on a band of
// dead ground above the home indicator — which is what it looked like: a
// screen cut off rather than a screen that runs out. Bleeding the ScrollView
// edge to edge and paying the inset in `contentContainerStyle` lets content
// travel the full height and simply come to rest clear of the indicator.
//
// `flexGrow: 1` is what makes this safe for a CENTRED column. The content box
// is at least a viewport tall, so a short column still centres exactly as it
// did in the padded View; a tall one grows the box and scrolls instead of
// overflowing it in both directions. That overflow is why the ledger's title
// sat on top of ‹ RETURN and its last row fell off the bottom.
export function Screen({
  children,
  scroll = false,
  bleed = false,
  header,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  // Pinned above a `scroll` page, outside the scroller and inside the top
  // inset. A TopBar put in with the children scrolls away with them and ends
  // up sitting on the status bar's own clock -- so the one control that leaves
  // the screen is the one that scrolls off it.
  header?: React.ReactNode;
  // No margin at all: the screen spends `useScreenInset()` on its own content.
  // For a screen whose scroller is too specialised to hand over.
  bleed?: boolean;
}) {
  const i = useScreenInset();
  const pad = { paddingTop: i.top, paddingBottom: i.bottom, paddingLeft: i.left, paddingRight: i.right };
  const inset = bleed ? null : pad;
  const contentInset = pad;
  return (
    <View style={{ flex: 1, backgroundColor: colors.museumWhite }}>
      {scroll ? (
        <>
        {header ? (
          <View style={{ paddingTop: i.top, paddingLeft: i.left, paddingRight: i.right }}>{header}</View>
        ) : null}
        <ScrollView
          style={{ flex: 1 }}
          // The inset is paid HERE, on the content, not on the container.
          // iOS does not add it for us: contentInsetAdjustmentBehavior only
          // adjusts under a navigation controller, and a bled ScrollView with
          // no bottom padding scrolls its last line clean under the home
          // indicator (verified on device -- the rites' closing liturgy ended
          // up with the indicator drawn through it).
          contentContainerStyle={{ ...contentInset, flexGrow: 1, paddingTop: header ? 0 : i.top }}
          // Every other scroller in the app hides its bar; a grey system rail
          // over the museum ground is the least in-voice thing on a page.
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        </>
      ) : (
        <View style={{ flex: 1, ...inset }}>{children}</View>
      )}
      <Grain />
    </View>
  );
}
