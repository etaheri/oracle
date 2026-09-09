import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import type { Reveal } from "@oracle/core";
import { Mono, role } from "./Text";
import { QuietLink } from "./Button";
import { capture } from "../analytics/analytics";
import { colors, space } from "../theme";

function webUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

export function ResolutionEvidence({ question }: { question: Reveal["questions"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  if (question.outcome === null || question.outcome === "void") return null;
  const pairedUrl = webUrl(question.evidence_url);
  const quote = pairedUrl && question.evidence_quote?.trim() ? question.evidence_quote : null;
  const sourceUrl = webUrl(question.source_url);
  const open = (url: string) => {
    setLinkFailed(false);
    void Linking.openURL(url).catch(() => setLinkFailed(true));
  };
  return <View style={{ gap: space(1) }}>
    {/* Bracketed, like every other control in this app.
        This was bare text in the same face and colour as the line above it —
        no underline, no bracket, no caret — so the one thing on the reveal
        that answers "how do you know?" read as a stray heading with nothing
        beneath it. The brackets are the footer rail's, in gilt: the frame
        says "control" while the label keeps the contrast gold cannot carry.
        Machine voice, because a control is recognised rather than read. */}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => { if (!expanded) capture("resolution_evidence_opened", { question_id: question.id }); setExpanded(v => !v); }} style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
      <Mono {...role.line} color={colors.mutedInk} style={[role.line.style, { textAlign: "left" }]}>
        <Text style={{ color: colors.agedGold }}>[</Text>
        {expanded ? " HIDE RESOLUTION " : " WHY THIS RESOLVED "}
        <Text style={{ color: colors.agedGold }}>]</Text>
      </Mono>
    </Pressable>
    {expanded && <View style={{ gap: space(2) }}>
      <Mono {...role.supporting}>{quote ?? "No resolution excerpt available."}</Mono>
      {quote && pairedUrl ? <QuietLink title="READ RESOLUTION SOURCE" onPress={() => open(pairedUrl)} /> : sourceUrl ? <QuietLink title="READ QUESTION SOURCE" onPress={() => open(sourceUrl)} /> : null}
      {linkFailed && <Mono {...role.supporting} accessibilityRole="alert">The source could not be opened. Try again.</Mono>}
    </View>}
  </View>;
}
