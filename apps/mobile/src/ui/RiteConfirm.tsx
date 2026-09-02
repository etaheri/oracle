import { View, Pressable, StyleSheet } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { colors, space } from "../theme";
import { Mono, Ritual } from "./Text";
import { GoldButton, QuietLink } from "./Button";

// The app asked its two most dramatic questions — striking the record, and a
// collided identity — through Alert.alert: SF Pro in a rounded system dialog,
// buttons reading CANCEL and STRIKE. It was the loudest tonal break in the
// app (refinement spec §3). A consequence this heavy deserves the app's own
// ceremony: museum ground, a framed panel, the machine's voice.
//
// The scrim is pressable and withdraws — the safe outcome is always the easy
// one; only the framed button commits.
export function RiteConfirm({ visible, title, body, confirmLabel, destructive = false, onConfirm, onWithdraw }: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onWithdraw: () => void;
}) {
  const reducedMotion = useReducedMotion();
  if (!visible) return null;
  const tone = destructive ? colors.vermilion : colors.agedGold;
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(180)}
      style={[StyleSheet.absoluteFill, { zIndex: 200, justifyContent: "center", padding: space(6) }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Withdraw"
        onPress={onWithdraw}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite, opacity: 0.96 }]}
      />
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: tone, padding: space(5), gap: space(4) }}
      >
        <Ritual bold size={16} color={colors.ink} letterSpacing={3} style={{ textAlign: "center" }}>{title}</Ritual>
        {body ? (
          <Mono size={11} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center", lineHeight: 18 }}>{body}</Mono>
        ) : null}
        <View style={{ gap: space(2) }}>
          <GoldButton title={confirmLabel} onPress={onConfirm} />
          <QuietLink title="Withdraw" onPress={onWithdraw} />
        </View>
      </View>
    </Animated.View>
  );
}
