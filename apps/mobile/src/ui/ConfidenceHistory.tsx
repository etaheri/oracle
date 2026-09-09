import type { ConfidenceHistory as History } from "@oracle/core";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { confidenceHistoryView } from "../game/confidenceHistoryView";
import { capture } from "../analytics/analytics";
import { colors, space, displayScale } from "../theme";
import { Mono, Serif, role } from "./Text";
import { DecodeLine } from "./DecodeText";

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
    // Two registers, the same way the Rites set them. The stamp and the
    // scope line are the machine naming a block you recognise at a glance;
    // the finding is the temple voice because it is the one sentence this
    // panel exists to say; everything under it is explanation, and
    // explanation is read, so it is set to be read. Before this the whole
    // panel was flat mono at 11 and 12 with default tracking -- a header, a
    // label, a finding and three paragraphs all in one undifferentiated
    // voice, which is what made a genuinely useful panel feel like a
    // settings screen. The reading voice here is `supporting`, not `reading`:
    // this panel lives inside the plaque, so it reads at the scale of the stat
    // rows it sits between rather than at the scale of a page of rules.
    <View style={{ borderTopWidth: 1, borderTopColor: colors.lineSoft, marginTop: space(3), paddingTop: space(4), gap: space(2) }}>
      <DecodeLine accessibilityRole="header" text="YOUR CONFIDENCE, TESTED" durationMs={380}
        {...role.action} color={colors.goldText} style={[role.action.style, { textAlign: "left" }]} />
      <View style={{ width: 24, height: 1, backgroundColor: colors.agedGold, opacity: 0.55 }} />
      <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>ALL RESOLVED CALLS · LIFETIME</Mono>
      <Serif size={displayScale.stamp} accessibilityLabel={headline.replaceAll("%", " percent")}>{headline}</Serif>
      <Mono {...role.supporting} color={colors.mutedInk} maxFontSizeMultiplier={0} accessibilityLabel={supporting.replaceAll("%", " percent")}>{supporting}</Mono>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Hide confidence history details" : "Show confidence history details"}
        accessibilityState={{ expanded }}
        onPress={() => { if (!expanded) capture("confidence_history_expanded"); setExpanded((value) => !value); }}
        style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", paddingVertical: space(2), opacity: pressed ? 0.6 : 1 })}
      >
        <Mono {...role.line} color={colors.goldText} maxFontSizeMultiplier={0} style={[role.line.style, { textAlign: "left", textDecorationLine: "underline" }]}>
          {expanded ? "HIDE DETAILS" : "SHOW DETAILS"}
        </Mono>
      </Pressable>
      {expanded && (
        <View style={{ gap: space(3) }}>
          {[...history.buckets].sort((a, b) => a.confidence - b.confidence).map((bucket) => (
            <View key={bucket.confidence} accessible accessibilityLabel={`${bucket.confidence} percent confidence. ${bucket.correct} correct out of ${bucket.total} resolved calls.${bucket.total < history.min_bucket_calls ? " Early record." : ""}`} style={{ gap: space(1) }}>
              <Mono {...role.line} color={colors.ink}>{`${bucket.confidence}% CONFIDENCE · ${bucket.correct}/${bucket.total} CORRECT`}</Mono>
              {bucket.total < history.min_bucket_calls && <Mono {...role.caption} color={colors.mutedInk} maxFontSizeMultiplier={0} style={[role.caption.style, { textAlign: "left" }]}>EARLY RECORD</Mono>}
            </View>
          ))}
          <Mono {...role.supporting} color={colors.mutedInk} maxFontSizeMultiplier={0}>These are results so far, not a measure of certainty about your ability.</Mono>
          <Mono {...role.supporting} color={colors.mutedInk} maxFontSizeMultiplier={0}>Includes resolved calls from incomplete rounds. Some calls do not qualify toward the forecast rating. History can change after an outcome correction or void.</Mono>
        </View>
      )}
    </View>
  );
}
