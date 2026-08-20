import { useState } from "react";
import { View, Pressable } from "react-native";
import { ApiError } from "../api/client";
import { useSubmit } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { colors, space } from "../theme";
import { Serif, Mono, Eyebrow } from "./Text";
import { GoldButton } from "./Button";
import { ConfidenceSlider } from "./ConfidenceSlider";
import type { RoundToday } from "@oracle/core";

export function QuestionCard({ q, onSealed }: { q: RoundToday["questions"][number]; onSealed: () => void }) {
  const { answers, setAnswer, setConfidence, markSealed } = useRoundStore();
  const entry = answers[q.id];
  const submit = useSubmit();
  const [error, setError] = useState<string | null>(null);

  async function seal() {
    if (!entry) return;
    setError(null);
    try {
      await submit.mutateAsync({ question_id: q.id, answer: entry.answer, confidence: entry.confidence, idempotency_key: entry.idempotencyKey });
      markSealed(q.id);
      onSealed();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "THE ORACLE HAS CLOSED" : "THE CONNECTION WAVERS — TRY AGAIN");
    }
  }

  return (
    <View style={{ borderWidth: 1, borderColor: q.is_big_one ? colors.gold : colors.line, backgroundColor: colors.panel, padding: space(4), gap: space(3) }}>
      <Eyebrow>{q.is_big_one ? "✶ The Big One · worth double" : q.category}</Eyebrow>
      <Serif size={22} style={{ lineHeight: 30 }}>{q.text}</Serif>
      <Mono size={10} color={colors.ash}>resolves per {q.source_name}</Mono>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        {([true, false] as const).map((v) => {
          const sel = entry?.answer === v;
          return (
            <Pressable key={String(v)} accessibilityRole="button" onPress={() => setAnswer(q.id, v)}
              style={{ flex: 1, borderWidth: 1, borderColor: sel ? colors.gold : colors.line, paddingVertical: space(2.5), alignItems: "center", backgroundColor: sel ? colors.goldWash : "transparent" }}>
              <Mono size={12} color={sel ? colors.gold : colors.boneDim} letterSpacing={5}>{v ? "YES" : "NO"}</Mono>
            </Pressable>
          );
        })}
      </View>
      {entry && <ConfidenceSlider value={entry.confidence} onChange={(c) => setConfidence(q.id, c)} />}
      {error && <Mono size={11} color={colors.oxblood} style={{ textAlign: "center" }}>{error}</Mono>}
      <GoldButton title={submit.isPending ? "SEALING…" : "SEAL THE PROPHECY"} onPress={seal} disabled={!entry || submit.isPending} />
    </View>
  );
}
