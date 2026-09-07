import type { ConfidenceHistory as History } from "@oracle/core";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { confidenceHistoryView } from "../game/confidenceHistoryView";
import { capture } from "../analytics/analytics";
import { colors, space } from "../theme";
import { Mono, Serif } from "./Text";

export function ConfidenceHistory({ history }: { history: History }) {
  const [expanded, setExpanded] = useState(false);
  const { state, selected } = confidenceHistoryView(history);
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    capture("confidence_history_viewed", { state });
  }, [state]);
  const headline = !selected
    ? "Your confidence history starts when your calls resolve."
    : state === "ready"
      ? `Of your ${selected.total} calls at ${selected.confidence}% confidence, ${selected.correct} were right.`
      : `${selected.total} of ${history.min_bucket_calls} resolved calls at ${selected.confidence}% toward a confidence snapshot.`;
  const supporting = state === "ready" && selected
    ? `${selected.confidence}% means expecting about ${selected.confidence / 10} in 10 over many calls. Small samples vary.`
    : "This builds as your predictions resolve. Choose the confidence you believe.";

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.lineSoft, marginTop: space(3), paddingTop: space(4), gap: space(2) }}>
      <Mono accessibilityRole="header" size={12} color={colors.goldText} maxFontSizeMultiplier={0}>YOUR CONFIDENCE, TESTED</Mono>
      <Mono size={11} maxFontSizeMultiplier={0}>All resolved calls · lifetime</Mono>
      <Serif size={18} accessibilityLabel={headline.replaceAll("%", " percent")}>{headline}</Serif>
      <Mono size={12} maxFontSizeMultiplier={0} accessibilityLabel={supporting.replaceAll("%", " percent")}>{supporting}</Mono>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide confidence history details" : "Show confidence history details"}
        accessibilityState={{ expanded }}
        onPress={() => { if (!expanded) capture("confidence_history_expanded"); setExpanded((value) => !value); }}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", paddingVertical: space(2), opacity: pressed ? 0.6 : 1 })}
      >
        <Mono size={12} color={colors.goldText} maxFontSizeMultiplier={0} style={{ textDecorationLine: "underline" }}>
          {expanded ? "Hide details" : "Show details"}
        </Mono>
      </Pressable>
      {expanded && (
        <View style={{ gap: space(3) }}>
          {[...history.buckets].sort((a, b) => a.confidence - b.confidence).map((bucket) => (
            <View key={bucket.confidence} accessible accessibilityLabel={`${bucket.confidence} percent confidence. ${bucket.correct} correct out of ${bucket.total} resolved calls.${bucket.total < history.min_bucket_calls ? " Early record." : ""}`} style={{ gap: space(1) }}>
              <Mono size={12} color={colors.ink} maxFontSizeMultiplier={0}>{`${bucket.confidence}% confidence · ${bucket.correct}/${bucket.total} correct`}</Mono>
              {bucket.total < history.min_bucket_calls && <Mono size={11} maxFontSizeMultiplier={0}>Early record</Mono>}
            </View>
          ))}
          <Mono size={12} maxFontSizeMultiplier={0}>These are results so far, not a measure of certainty about your ability.</Mono>
          <Mono size={12} maxFontSizeMultiplier={0}>Includes resolved calls from incomplete rounds. Some calls do not qualify toward the competitive Oracle Score. History can change after an outcome correction or void.</Mono>
        </View>
      )}
    </View>
  );
}
