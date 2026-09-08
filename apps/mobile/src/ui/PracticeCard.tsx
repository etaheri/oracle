import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import type { Exhibition, RoundToday } from "@oracle/core";
import { CardChrome } from "./CardChrome";
import { DecodeLine } from "./DecodeText";
import { practiceResult, type PracticePrediction } from "../game/practiceResult";
import { beginExhibition, revealExhibition, retryExhibition, sealExhibition } from "../game/exhibitionFlow";
import { CardStage } from "./CardStage";
import { OracleCard } from "./OracleCard";
import { ConvictionColumn } from "./ConvictionColumn";
import { confidenceMeaning } from "../game/confidence";
import { payoffLine } from "../game/payoffLine";
import { Mono, Serif, Ritual, role } from "./Text";
import { GoldButton, QuietLink } from "./Button";
import { colors, space } from "../theme";

function exhibitionQuestion(exhibition: Exhibition): RoundToday["questions"][number] {
  return {
    id: exhibition.id, slot: 1, is_big_one: false, text: exhibition.question,
    category: "EXHIBITION", source_name: exhibition.sourceName,
    resolution_criteria: "Practice only; this exhibition is unranked.",
    locks_at: "2099-01-01T00:00:00Z", lock_healed: false,
  };
}

export function PracticeCard({ exhibition, onCompleted }: { exhibition: Exhibition; onCompleted: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [buttons, setButtons] = useState(false);
  const [flow, setFlow] = useState(() => beginExhibition(exhibition));
  const [previous, setPrevious] = useState<PracticePrediction | null>(null);
  const [lean, setLean] = useState({ conf: null as number | null, side: true, active: false });
  const onLean = useCallback((conf: number | null, side: boolean, active: boolean) => {
    setLean(prev => prev.conf === conf && prev.side === side && prev.active === active ? prev : { conf, side, active });
  }, []);
  const receipt = flow.prediction;
  const revealed = flow.phase === "revealed";
  const provenance = exhibition.kind === "historical" ? "PAST ROUND · UNRANKED" : "FICTIONAL · UNRANKED";
  const question = exhibitionQuestion(exhibition);

  return <View style={{ flex: 1, minHeight: 0, gap: space(3) }}>
    <View style={{ gap: space(1) }}>
      <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{provenance}</Mono>
      <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>
        {exhibition.kind === "historical" ? "CONTEXT RECORDED BEFORE THE OUTCOME" : "FICTIONAL EXAMPLE · NO REAL DRAW OCCURRED"}
      </Mono>
    </View>
    <CardStage>{height => <View>
      {receipt ? <CardChrome height={height} slot={1} title={revealed ? "EXHIBITION RESULT" : "CALL SEALED"} status={provenance}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space(3) }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
          <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>YOUR CALL · {receipt.answer ? "YES" : "NO"} · {receipt.confidence}%</Mono>
          {revealed ? <PracticeResult prediction={receipt} exhibition={exhibition} previous={previous} /> : <>
            <Serif size={22} style={{ textAlign: "center", lineHeight: 32 }}>Your call is sealed.</Serif>
            <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>This one-question exhibition is immediate and unranked.</Mono>
          </>}
        </ScrollView>
        {!revealed && <GoldButton title="REVEAL THE RESULT" onPress={() => {
          const next = revealExhibition(flow); setFlow(next.flow); if (next.completedNow) onCompleted();
        }} />}
      </CardChrome> : <OracleCard height={height} key={attempt} q={question} roundLocksAt={null} onSealed={() => {}} onLean={onLean} forceButtons={buttons}
        practice={{ context: exhibition.context, onSeal: (answer, confidence) => {
          setFlow(current => sealExhibition(current, { answer, confidence }));
          setLean({ conf: null, side: answer, active: false });
        } }} />}
      {!receipt && (lean.active || lean.conf !== null) && <ConvictionColumn conf={lean.conf} side={lean.side} />}
    </View>}</CardStage>
    <View style={{ minHeight: 48, gap: space(1), justifyContent: "center" }}>
      {lean.conf !== null ? <>
        <Mono size={10} color={colors.goldText} style={{ textAlign: "center" }}>{confidenceMeaning(lean.conf)}</Mono>
        <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{payoffLine(lean.conf, false)}</Mono>
      </> : receipt ? <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>UNRANKED · YOUR RECORD AND STREAK ARE UNCHANGED.</Mono> :
        <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{previous ? "SAME EXAMPLE AND RESULT. TRY A DIFFERENT CONFIDENCE OR SIDE." : "PULL TO ADJUST. RETURN TO CENTER TO CANCEL. RELEASE TO SEAL."}</Mono>}
    </View>
    {receipt ? revealed && <QuietLink title="TRY THE SAME EXAMPLE AGAIN" onPress={() => {
      setPrevious(receipt); setFlow(current => retryExhibition(current)); setAttempt(n => n + 1);
    }} /> : <QuietLink title={buttons ? "USE THE PULL" : "USE HOLD BUTTONS"} onPress={() => setButtons(!buttons)} />}
  </View>;
}

const signed = (points: number) => points < 0 ? `−${Math.abs(points)}` : `+${points}`;
const call = (answer: boolean) => answer ? "YES" : "NO";

function PracticeResult({ prediction, exhibition, previous }: { prediction: PracticePrediction; exhibition: Exhibition; previous: PracticePrediction | null }) {
  const result = practiceResult(prediction, exhibition);
  const outcome = exhibition.outcome === "yes";
  const oracleLabel = exhibition.kind === "fictional" ? "EXAMPLE ORACLE FORECAST" : "ORACLE CALL";
  const winner = result.winner === "tie" ? "You tied the Oracle in this exhibition"
    : exhibition.kind === "fictional"
      ? result.winner === "you" ? "Your call outscored the example Oracle forecast" : "The example Oracle forecast outscored your call"
      : result.winner === "you" ? "You outscored the Oracle in this exhibition" : "The Oracle outscored you in this exhibition";
  const explanation = result.oracleAbstained
    ? `The Oracle stayed neutral at 50%. Your ${prediction.confidence}% confidence determined your side's result.`
    : result.sameAnswer
      ? `You both chose ${call(prediction.answer)}. The confidence difference produced the points gap.`
      : `You chose ${call(prediction.answer)} and the Oracle chose ${call(result.oracleAnswer!)}. The outcome favored ${call(outcome)}.`;

  return <>
    <DecodeLine serif text={`Actual outcome: ${call(outcome)}.`} size={22} style={{ textAlign: "center", lineHeight: 32 }} />
    <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{exhibition.kind === "fictional" ? "FICTIONAL OUTCOME" : `PAST ROUND${exhibition.roundDate ? ` · ${exhibition.roundDate}` : ""}`}</Mono>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>
      {result.oracleAbstained ? `${oracleLabel} · ABSTAINED · 50%` : `${oracleLabel} · ${call(result.oracleAnswer!)} · ${result.oracleConfidence}%`}
    </Mono>
    <View style={{ flexDirection: "row", justifyContent: "space-around", gap: space(2) }}>
      <View style={{ flex: 1, alignItems: "center" }}><Mono {...role.caption}>YOUR BASE POINTS</Mono><Ritual size={22} bold>{signed(result.youPoints)}</Ritual></View>
      <View style={{ flex: 1, alignItems: "center" }}><Mono {...role.caption}>ORACLE BASE POINTS</Mono><Ritual size={22} bold>{signed(result.oraclePoints)}</Ritual></View>
    </View>
    <Serif size={20} style={{ textAlign: "center", lineHeight: 28 }}>{winner}</Serif>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>{explanation}</Mono>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>If the outcome had been {call(!outcome)}, your same call would score {signed(result.oppositePoints)} points.</Mono>
    {previous && <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>Previous try: {call(previous.answer)} at {previous.confidence}% → {signed(practiceResult(previous, exhibition).youPoints)} points. Same example and result.</Mono>}
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>The daily round also ranks you against other players.</Mono>
  </>;
}
