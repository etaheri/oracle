import { useState } from "react";
import { ScrollView, View } from "react-native";
import { PRACTICE_FORTUNE, practiceLine, type Exhibition, type RoundToday } from "@oracle/core";
import { CardChrome } from "./CardChrome";
import { DecodeLine } from "./DecodeText";
import { practiceResult } from "../game/practiceResult";
import { formatFortune, signedFortune } from "../game/fortuneText";
import { beginExhibition, revealExhibition, retryExhibition, sealExhibition } from "../game/exhibitionFlow";
import { CardStage } from "./CardStage";
import { OracleCard } from "./OracleCard";
import { Mono, Ritual, Serif, role } from "./Text";
import { GoldButton, QuietLink } from "./Button";
import { colors, space, displayScale } from "../theme";

function exhibitionQuestion(exhibition: Exhibition): RoundToday["questions"][number] {
  return {
    id: exhibition.id, slot: 1, is_big_one: false, text: exhibition.question,
    category: "PRACTICE", source_name: exhibition.sourceName,
    resolution_criteria: "Practice only; this question is unranked.",
    locks_at: "2099-01-01T00:00:00Z", lock_healed: false, struck: false, struck_reason: null, line_p_yes: practiceLine(exhibition),
  };
}

export function PracticeCard({ exhibition, onCompleted }: { exhibition: Exhibition; onCompleted: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [flow, setFlow] = useState(() => beginExhibition(exhibition));
  const receipt = flow.prediction;
  const revealed = flow.phase === "revealed";
  const provenance = exhibition.kind === "historical" ? "PAST ROUND · UNRANKED" : "FICTIONAL · UNRANKED";
  const question = exhibitionQuestion(exhibition);
  const result = receipt ? practiceResult(receipt, exhibition) : null;

  return <View style={{ flex: 1, minHeight: 0, gap: space(3) }}>
    {/* One line, and it teaches rather than disclaims.
        This screen declared itself an unranked practice question five times
        before the question: the screen's eyebrow, a provenance caption, this
        line, the card's own [ PRACTICE ] head and its margin status. The
        card carries its own provenance the way every other card does, so
        what is left here is the thing a first-time player actually needs to
        know — what this is, and that it is free to get wrong. */}
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>
      {exhibition.kind === "historical"
        ? "A real question from a past round, with its context as it stood. You play it on a practice fortune of 1,000; nothing here touches your record."
        : "A made-up example — no real draw occurred. You play it on a practice fortune of 1,000; nothing here touches your record."}
    </Mono>
    <CardStage>{height => <View>
      {result ? <CardChrome height={height} slot={1} title={revealed ? "PRACTICE RESULT" : "CALL SEALED"} status={provenance}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space(3) }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
          <Mono {...role.line} color={colors.mutedInk}>{result.receipt}</Mono>
          {revealed ? <PracticeResult result={result} exhibition={exhibition} /> : <>
            <Serif size={displayScale.lead} style={{ textAlign: "center", lineHeight: 32 }}>Your call is sealed.</Serif>
            <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>You made your call. Now see how it compares.</Mono>
          </>}
        </ScrollView>
        {!revealed && <GoldButton title="REVEAL THE RESULT" onPress={() => {
          const next = revealExhibition(flow); setFlow(next.flow); if (next.completedNow) onCompleted();
        }} />}
      </CardChrome> : <OracleCard height={height} key={attempt} q={question} roundLocksAt={null} fortune={PRACTICE_FORTUNE} onSealed={() => {}}
        practice={{ context: exhibition.context, stamp: "PRACTICE · UNRANKED", onSeal: (answer, confidence) => {
          setFlow(current => sealExhibition(current, { answer, confidence }));
        } }} />}
    </View>}</CardStage>
    <View style={{ minHeight: 48, gap: space(1), justifyContent: "center" }}>
      <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>
        {result ? "UNRANKED · YOUR FORTUNE, RECORD AND STREAK ARE UNCHANGED." : "TAP A SIDE, THEN A STAKE, THEN SEAL."}
      </Mono>
    </View>
    {revealed && <QuietLink title="TRY ANOTHER STAKE" onPress={() => {
      setFlow(current => retryExhibition(current)); setAttempt(n => n + 1);
    }} />}
  </View>;
}

const call = (answer: boolean) => answer ? "YES" : "NO";

function PracticeResult({ result, exhibition }: { result: ReturnType<typeof practiceResult>; exhibition: Exhibition }) {
  const outcome = exhibition.outcome === "yes";
  const roundDate = exhibition.roundDate;

  return <>
    <DecodeLine serif text={`Actual outcome: ${call(outcome)}.`} size={22} style={{ textAlign: "center", lineHeight: 32 }} />
    <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{exhibition.kind === "fictional" ? "FICTIONAL OUTCOME" : `PAST ROUND${roundDate ? ` · ${roundDate}` : ""}`}</Mono>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>{result.oracleLine}</Mono>
    <View style={{ flexDirection: "row", justifyContent: "space-around", gap: space(2) }}>
      <View style={{ flex: 1, alignItems: "center" }}><Mono {...role.caption}>YOUR STAKE</Mono><Ritual bold size={displayScale.lead} color={colors.ink}>{formatFortune(result.stake)}</Ritual></View>
      <View style={{ flex: 1, alignItems: "center" }}><Mono {...role.caption}>NET</Mono><Ritual bold size={displayScale.lead} color={result.delta >= 0 ? colors.goldText : colors.vermilion}>{signedFortune(result.delta)}</Ritual></View>
    </View>
    <Serif size={displayScale.lead} style={{ textAlign: "center", lineHeight: 28 }}>{result.verdict}</Serif>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>{result.counterfactual}</Mono>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>Practice fortune, nothing changed.</Mono>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>Next: a daily round against the Oracle's lines, with your real fortune.</Mono>
  </>;
}
