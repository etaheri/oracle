import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import type { Reveal } from "@oracle/core";
import { Mono, role } from "./Text";
import { QuietLink } from "./Button";
import { capture } from "../analytics/analytics";
import { space } from "../theme";

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
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => { if (!expanded) capture("resolution_evidence_opened", { question_id: question.id }); setExpanded(v => !v); }} style={{ minHeight: 44, justifyContent: "center" }}>
      <Mono {...role.supporting}>{expanded ? "HIDE RESOLUTION" : "WHY THIS RESOLVED"}</Mono>
    </Pressable>
    {expanded && <View style={{ gap: space(2) }}>
      <Mono {...role.supporting}>{quote ?? "No resolution excerpt available."}</Mono>
      {quote && pairedUrl ? <QuietLink title="READ RESOLUTION SOURCE" onPress={() => open(pairedUrl)} /> : sourceUrl ? <QuietLink title="READ QUESTION SOURCE" onPress={() => open(sourceUrl)} /> : null}
      {linkFailed && <Mono {...role.supporting} accessibilityRole="alert">The source could not be opened. Try again.</Mono>}
    </View>}
  </View>;
}
