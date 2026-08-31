import { useState } from "react";
import { View } from "react-native";
import { useCanvasRef } from "@shopify/react-native-skia";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual } from "../ui/Text";
import { AsciiDust } from "../ui/TerminalPatina";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton } from "../ui/Button";
import { PlaqueShareCanvas } from "../ui/PlaqueShareCard";
import { shareSnapshot } from "../ui/ShareCard";
import { useMeLedger } from "../api/hooks";
import { colors, space } from "../theme";
import { LITURGY_LINES, calibrationVerdict } from "@oracle/core";
import { shieldStat } from "../game/shieldStat";

// The Forecaster's Ledger (voice spec §6): a museum specimen plaque. Stats in
// machine voice, one epithet with its receipt — identity only with evidence.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Mono size={11} color={colors.mutedInk} letterSpacing={2}>{label}</Mono>
      <Mono size={11} color={colors.ink} letterSpacing={2}>{value}</Mono>
    </View>
  );
}

export default function Ledger() {
  const ledger = useMeLedger();
  const canvasRef = useCanvasRef();
  const [sharing, setSharing] = useState(false);

  if (!ledger.data) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <DecodeLine text="THE LEDGER IS CONSULTED" cursor size={10} color={colors.goldText} letterSpacing={4} style={{ textAlign: "center" }} />
      </View>
    </Screen>
  );

  const d = ledger.data;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The forecaster&apos;s ledger</Eyebrow>
        <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold, padding: space(5), gap: space(4) }}>
          <View style={{ alignItems: "center", gap: space(2) }}>
            <Ritual bold size={24} color={colors.ink} letterSpacing={3} style={{ textAlign: "center" }}>{d.epithet.title}</Ritual>
            <Mono size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>{d.epithet.receipt}</Mono>
          </View>
          <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.4 }} />
          <View style={{ gap: space(2) }}>
            <Stat label="ORACLE SCORE" value={d.oracle_score === null ? "UNWRITTEN" : String(d.oracle_score)} />
            <Stat label="DAYS CONSULTED" value={String(d.days_consulted)} />
            <Stat label="CURRENT VIGIL" value={`${d.streak} DAYS`} />
            <Stat label="ACCURACY" value={pct(d.accuracy_pct)} />
            <Stat label="AVG CONVICTION" value={pct(d.avg_confidence)} />
            <Stat label="AGAINST THE TIDE" value={`×${d.tide_wins}`} />
            <Stat label="SHIELDS IN RESERVE" value={shieldStat(d.free_shield_available, d.paid_shields)} />
            {calibrationVerdict(d.avg_confidence, d.accuracy_pct, 0) && (
              <DecodeLine
                text={calibrationVerdict(d.avg_confidence, d.accuracy_pct, 0)!}
                delayMs={300} durationMs={600}
                size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center", marginTop: space(2) }}
              />
            )}
          </View>
        </View>
        <View style={{ gap: space(1) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={9} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </View>
        <GoldButton
          title={sharing ? "PREPARING…" : "DECLARE YOURSELF"}
          onPress={async () => {
            setSharing(true);
            try { await shareSnapshot(canvasRef, "oracle-plaque.png", d.epithet.title); } catch {} finally { setSharing(false); }
          }}
        />
        <PlaqueShareCanvas canvasRef={canvasRef} data={d} />
      </View>
    </Screen>
  );
}
