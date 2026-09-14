// apps/mobile/src/ui/EvidenceCard.tsx
// One item of the shared pack (design 2026-09-11 §15.3), in the question
// card's materials at small scale: the hairline frame and the fresco ground,
// the title in serif, the source and date in tracked caps, the highlight in
// sentence case. Tapping opens the URL.
import { useState } from "react";
import { Linking, Pressable } from "react-native";
import type { EvidenceItem } from "@oracle/core";
import { Mono, Serif, role } from "./Text";
import { colors, space } from "../theme";

function dateStamp(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "UNDATED";
}

export function EvidenceCard({ item }: { item: EvidenceItem }) {
  const [failed, setFailed] = useState(false);
  const open = () => { setFailed(false); void Linking.openURL(item.url).catch(() => setFailed(true)); };
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${item.title}, ${item.source}, ${dateStamp(item.published_at)}`} onPress={open}
      style={({ pressed }) => ({ borderWidth: 1, borderColor: colors.line, backgroundColor: colors.frescoWhite, padding: space(3), gap: space(1), opacity: pressed ? 0.7 : 1 })}>
      <Serif size={14} color={colors.ink} numberOfLines={2} style={{ lineHeight: 19 }}>{item.title}</Serif>
      <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>{`${item.source.toUpperCase()} · ${dateStamp(item.published_at)}`}</Mono>
      <Mono {...role.supporting} color={colors.mutedInk} numberOfLines={4}>{item.highlight}</Mono>
      {failed && <Mono {...role.supporting} accessibilityRole="alert">The source could not be opened. Try again.</Mono>}
    </Pressable>
  );
}
