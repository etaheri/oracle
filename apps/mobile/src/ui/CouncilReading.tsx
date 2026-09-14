// apps/mobile/src/ui/CouncilReading.tsx
// The Oracle's reading (design 2026-09-11 §15.3): under a model member's row,
// a collapsed link that opens the member's paragraph, the evidence it cited
// as cards, and an "also read" row for the rest of the pack. The paragraph is
// reading copy, set in sentence case as the member wrote it; the link and
// the labels are machine voice.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { CouncilEntry, EvidenceItem } from "@oracle/core";
import { Mono, Serif, role } from "./Text";
import { EvidenceCard } from "./EvidenceCard";
import { readingFor, memberName } from "../game/council";
import { capture } from "../analytics/analytics";
import { colors, space } from "../theme";

export function CouncilReading({ entry, pack, questionId }: { entry: CouncilEntry; pack: EvidenceItem[]; questionId: string }) {
  const [open, setOpen] = useState(false);
  const reading = readingFor(entry, pack);
  if (!reading) return null;
  const name = memberName(entry.member).toUpperCase();
  return (
    <View style={{ gap: space(2) }}>
      {/* Bracketed, like every other disclosure in this app (ResolutionEvidence's
          [ WHY THIS RESOLVED ]) — not an underlined QuietLink, which reads as a
          second control style and, at 44pt tall with its own padding, doubled
          every card's height with three of these stacked under one line. */}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => {
        if (!open) capture("reading_opened", { question_id: questionId, member: entry.member });
        setOpen((v) => !v);
      }} style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
        <Mono {...role.line} color={colors.mutedInk} style={[role.line.style, { textAlign: "left" }]}>
          <Text style={{ color: colors.agedGold }}>[</Text>
          {open ? ` HIDE ${name}'S READING ` : ` ${name}'S READING `}
          <Text style={{ color: colors.agedGold }}>]</Text>
        </Mono>
      </Pressable>
      {open && (
        <View style={{ gap: space(3) }}>
          <Serif size={15} color={colors.ink} style={{ lineHeight: 22 }}>{reading.paragraph}</Serif>
          {reading.cited.map((item) => <EvidenceCard key={item.rank} item={item} />)}
          {reading.alsoRead.length > 0 && (
            <View style={{ gap: space(1) }}>
              <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>ALSO READ</Mono>
              {reading.alsoRead.map((item) => (
                <Mono key={item.rank} {...role.supporting} color={colors.mutedInk} numberOfLines={1}>{`[${item.rank}] ${item.title} · ${item.source}`}</Mono>
              ))}
            </View>
          )}
          {reading.cited.length === 0 && reading.alsoRead.length === 0 && (
            <Mono {...role.supporting} color={colors.mutedInk}>No evidence was retrieved for this question.</Mono>
          )}
        </View>
      )}
    </View>
  );
}
