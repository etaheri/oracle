import { useCallback, useState } from "react";
import { View } from "react-native";
import type { RoundToday } from "@oracle/core";
import { CardStage } from "./CardStage";
import { OracleCard } from "./OracleCard";
import { ConvictionColumn } from "./ConvictionColumn";
import { confidenceMeaning } from "../game/confidence";
import { payoffLine } from "../game/payoffLine";
import { Mono, Serif } from "./Text";
import { QuietLink } from "./Button";
import { colors, space } from "../theme";

const question: RoundToday["questions"][number] = {
  id: "00000000-0000-4000-8000-000000000000", slot: 1, is_big_one: false,
  text: "Will the home team win its next game?", category: "practice", source_name: "UNSCORED EXAMPLE",
  resolution_criteria: "Practice only; no real outcome or score.", locks_at: "2099-01-01T00:00:00Z", lock_healed: false,
};

export function PracticeCard({ onCompleted }: { onCompleted: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [buttons, setButtons] = useState(false);
  const [receipt, setReceipt] = useState<{ answer: boolean; confidence: number } | null>(null);
  const [lean, setLean] = useState({ conf: null as number | null, side: true, active: false });
  const onLean = useCallback((conf: number | null, side: boolean, active: boolean) => {
    setLean(prev => prev.conf === conf && prev.side === side && prev.active === active ? prev : { conf, side, active });
  }, []);
  return <View style={{ flex: 1, minHeight: 0, gap: space(3) }}>
    <CardStage>{height => <View>
      {receipt ? <View style={{ gap: space(4), padding: space(5) }}>
        <Serif style={{ textAlign: "center" }}>A practice answer. Nothing recorded.</Serif>
        <Mono style={{ textAlign: "center" }}>{receipt.answer ? "YES" : "NO"} AT {receipt.confidence}%</Mono>
      </View> : <OracleCard height={height} key={attempt} q={question} roundLocksAt={null} onSealed={() => {}} onLean={onLean} forceButtons={buttons}
        practice={{ onSeal: (answer, confidence) => { setReceipt({ answer, confidence }); setLean({ conf: null, side: answer, active: false }); onCompleted(); } }} />}
      {!receipt && (lean.active || lean.conf !== null) && <ConvictionColumn conf={lean.conf} side={lean.side} />}
    </View>}</CardStage>
    <View style={{ minHeight: 48, gap: space(1), justifyContent: "center" }}>
      {lean.conf !== null ? <>
        <Mono size={10} color={colors.goldText} style={{ textAlign: "center" }}>{confidenceMeaning(lean.conf)}</Mono>
        <Mono size={10} style={{ textAlign: "center" }}>{payoffLine(lean.conf, false)}</Mono>
      </> : !receipt && <Mono size={10} style={{ textAlign: "center" }}>PULL TO ADJUST. RETURN TO CENTER TO CANCEL. RELEASE TO SEAL.</Mono>}
    </View>
    {receipt ? <QuietLink title="TRY AGAIN" onPress={() => { setReceipt(null); setAttempt(n => n + 1); }} /> :
      <QuietLink title={buttons ? "USE THE PULL" : "USE HOLD BUTTONS"} onPress={() => setButtons(!buttons)} />}
  </View>;
}
