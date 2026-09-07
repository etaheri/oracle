import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import type { RoundToday } from "@oracle/core";
import { CardChrome } from "./CardChrome";
import { DecodeLine } from "./DecodeText";
import { practiceResult, type PracticePrediction } from "../game/practiceResult";
import { CardStage } from "./CardStage";
import { OracleCard } from "./OracleCard";
import { ConvictionColumn } from "./ConvictionColumn";
import { confidenceMeaning } from "../game/confidence";
import { payoffLine } from "../game/payoffLine";
import { Mono, Serif, Ritual, role } from "./Text";
import { GoldButton, QuietLink } from "./Button";
import { colors, space } from "../theme";

const question: RoundToday["questions"][number] = {
  id: "00000000-0000-4000-8000-000000000000", slot: 1, is_big_one: false,
  text: "Will the home team win its next game?", category: "practice", source_name: "UNSCORED EXAMPLE",
  resolution_criteria: "Practice only; no real outcome or score.", locks_at: "2099-01-01T00:00:00Z", lock_healed: false,
};

export function PracticeCard({ onCompleted }: { onCompleted: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [buttons, setButtons] = useState(false);
  const [receipt, setReceipt] = useState<PracticePrediction | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [previous, setPrevious] = useState<PracticePrediction | null>(null);
  const [lean, setLean] = useState({ conf: null as number | null, side: true, active: false });
  const onLean = useCallback((conf: number | null, side: boolean, active: boolean) => {
    setLean(prev => prev.conf === conf && prev.side === side && prev.active === active ? prev : { conf, side, active });
  }, []);
  return <View style={{ flex: 1, minHeight: 0, gap: space(3) }}>
    <CardStage>{height => <View>
      {receipt ? <CardChrome height={height} slot={1} title={revealed ? "PRACTICE RESULT" : "PRACTICE SEALED"} status="FICTIONAL · UNSCORED">
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space(4) }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
          <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>YOU CHOSE {receipt.answer ? "YES" : "NO"} AT {receipt.confidence}%</Mono>
          {revealed ? <PracticeResult prediction={receipt} previous={previous} /> : <>
            <Serif size={22} style={{ textAlign: "center", lineHeight: 32 }}>Your prediction is sealed.</Serif>
            <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>In the daily game, you wait for the real outcome. Here, reveal a fictional result now.</Mono>
          </>}
        </ScrollView>
        {!revealed && <GoldButton title="REVEAL PRACTICE RESULT" onPress={() => { setRevealed(true); onCompleted(); }} />}
      </CardChrome> : <OracleCard height={height} key={attempt} q={question} roundLocksAt={null} onSealed={() => {}} onLean={onLean} forceButtons={buttons}
        practice={{ onSeal: (answer, confidence) => { setReceipt({ answer, confidence }); setLean({ conf: null, side: answer, active: false }); } }} />}
      {!receipt && (lean.active || lean.conf !== null) && <ConvictionColumn conf={lean.conf} side={lean.side} />}
    </View>}</CardStage>
    <View style={{ minHeight: 48, gap: space(1), justifyContent: "center" }}>
      {lean.conf !== null ? <>
        <Mono size={10} color={colors.goldText} style={{ textAlign: "center" }}>{confidenceMeaning(lean.conf)}</Mono>
        <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{payoffLine(lean.conf, false)}</Mono>
      </> : receipt ? <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>PRACTICE ONLY · YOUR SCORE AND STREAK ARE UNCHANGED.</Mono> :
        <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>{previous ? "SAME FICTIONAL GAME. TRY A DIFFERENT CONFIDENCE OR SIDE." : "PULL TO ADJUST. RETURN TO CENTER TO CANCEL. RELEASE TO SEAL."}</Mono>}
    </View>
    {receipt ? revealed && <QuietLink title="TRY A DIFFERENT PREDICTION" onPress={() => { setPrevious(receipt); setReceipt(null); setRevealed(false); setAttempt(n => n + 1); }} /> :
      <QuietLink title={buttons ? "USE THE PULL" : "USE HOLD BUTTONS"} onPress={() => setButtons(!buttons)} />}
  </View>;
}

const signed = (points: number) => points < 0 ? `−${Math.abs(points)}` : `+${points}`;

function PracticeResult({ prediction, previous }: { prediction: PracticePrediction; previous: PracticePrediction | null }) {
  const result = practiceResult(prediction);
  return <>
    <DecodeLine serif text="The home team won." size={22} style={{ textAlign: "center", lineHeight: 32 }} />
    <Mono {...role.caption} style={[role.caption.style, { textAlign: "center" }]}>FICTIONAL OUTCOME · YES</Mono>
    <Ritual size={24} bold color={result.correct ? colors.goldText : colors.vermilion} style={{ textAlign: "center" }}>
      {signed(result.points)} POINTS
    </Ritual>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>
      {result.correct ? "Your answer was right. More confidence earns more when you are right." : "Your answer was wrong. More confidence costs more when you are wrong."}
    </Mono>
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>
      If the home team had lost, that same prediction would score {signed(result.oppositePoints)} points.
    </Mono>
    {previous && <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>
      Previous try: {previous.answer ? "YES" : "NO"} at {previous.confidence}% → {signed(practiceResult(previous).points)} points. Same fictional outcome.
    </Mono>}
    <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>In a real round, choose the confidence you actually believe. The outcome is not known when you seal.</Mono>
  </>;
}
