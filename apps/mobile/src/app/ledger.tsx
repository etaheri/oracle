import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCanvasRef } from "@shopify/react-native-skia";
import * as AppleAuthentication from "expo-apple-authentication";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual } from "../ui/Text";
import { AsciiDust } from "../ui/TerminalPatina";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { RiteConfirm } from "../ui/RiteConfirm";
import { PlaqueShareCanvas } from "../ui/PlaqueShareCard";
import { shareSnapshot } from "../ui/ShareCard";
import { useMeLedger } from "../api/hooks";
import { appleClaim, appleRestore, strikeRecord } from "../api/identity";
import { usePlusStore } from "../monetization/plusState";
import { colors, space } from "../theme";
import { LITURGY_LINES, calibrationVerdict } from "@oracle/core";
import { shieldStat } from "../game/shieldStat";
import { scoreValue } from "../game/scoreProgress";

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
  const qc = useQueryClient();
  const canvasRef = useCanvasRef();
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const router = useRouter();
  const plusActive = usePlusStore((s) => s.plusActive);

  // AppleAuthenticationButton renders nothing (and warns in dev) if the
  // platform can't support Sign in with Apple — non-iOS, or an iOS
  // simulator without the capability. Gate the whole claim row on this so
  // it degrades to simply not offering the row, rather than a dead button.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => { if (alive) setAppleAvailable(ok); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Which rite is being asked, if any. Only one can be open at a time.
  const [rite, setRite] = useState<"collision" | "strike" | null>(null);

  const handleClaim = () => {
    void (async () => {
      const result = await appleClaim();
      if (result === "claimed") qc.invalidateQueries({ queryKey: ["me", "ledger"] });
      else if (result === "collision") setRite("collision");
    })();
  };

  const confirmRestore = () => {
    setRite(null);
    void (async () => {
      const r = await appleRestore();
      if (r === "restored") {
        qc.invalidateQueries();
        router.replace("/");
      }
    })();
  };

  const confirmStrike = () => {
    setRite(null);
    void (async () => {
      const ok = await strikeRecord();
      if (ok) router.replace("/");
    })();
  };

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

  async function handleShare() {
    setSharing(true);
    setShareError(null);
    try {
      await shareSnapshot(canvasRef, "oracle-plaque.png", d.epithet.title);
    } catch {
      setShareError("THE PLAQUE WOULD NOT LEAVE. TRY AGAIN.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The forecaster&apos;s ledger</Eyebrow>
        <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold, padding: space(5), gap: space(4) }}>
          <Eyebrow>Epithet of the last 28 days</Eyebrow>
          <View style={{ alignItems: "center", gap: space(2) }}>
            <Ritual bold size={24} color={colors.ink} letterSpacing={3} style={{ textAlign: "center" }}>{d.epithet.title}</Ritual>
            <Mono size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>{d.epithet.receipt}</Mono>
          </View>
          <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.4 }} />
          <View style={{ gap: space(2) }}>
            <Stat label="ORACLE SCORE" value={scoreValue(d.oracle_score, d.calls_rated)} />
            <Stat label="DAYS CONSULTED" value={String(d.days_consulted)} />
            <Stat label="CURRENT VIGIL" value={`${d.streak} DAYS`} />
            <Stat label="ACCURACY" value={pct(d.accuracy_pct)} />
            <Stat label="AVG CONVICTION" value={pct(d.avg_confidence)} />
            <Stat label="AGAINST THE TIDE" value={`×${d.tide_wins}`} />
            <Stat label="SHIELDS IN RESERVE" value={shieldStat(d.free_shield_available, d.paid_shields)} />
            {calibrationVerdict(d.avg_confidence, d.accuracy_pct, d.calls_answered) && (
              <DecodeLine
                text={calibrationVerdict(d.avg_confidence, d.accuracy_pct, d.calls_answered)!}
                delayMs={300} durationMs={600}
                size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center", marginTop: space(2) }}
              />
            )}
          </View>
          {d.claimed ? (
            <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center", marginTop: space(2) }}>
              THE RECORD IS CLAIMED
            </Mono>
          ) : appleAvailable ? (
            <View style={{ alignItems: "center", gap: space(2), marginTop: space(2) }}>
              <Eyebrow>Claim your record</Eyebrow>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={0}
                style={{ width: 230, height: 44 }}
                onPress={handleClaim}
              />
            </View>
          ) : null}
        </View>
        {!plusActive && <QuietLink title="Oracle plus" onPress={() => router.push("/plus")} />}
        <View style={{ gap: space(1) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={10} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </View>
        <GoldButton title={sharing ? "PREPARING…" : "DECLARE YOURSELF"} onPress={handleShare} />
        {shareError && (
          <Mono size={10} color={colors.vermilion} letterSpacing={2} style={{ textAlign: "center" }}>{shareError}</Mono>
        )}
        <QuietLink title="Strike the record" onPress={() => setRite("strike")} />
        <PlaqueShareCanvas canvasRef={canvasRef} data={d} />
      </View>
      <RiteConfirm
        visible={rite === "collision"}
        title="THE RECORD ALREADY BEARS A NAME"
        body="RESTORE IT, AND THIS DEVICE TAKES UP THE RECORD THAT NAME ALREADY HOLDS."
        confirmLabel="RESTORE THE RECORD"
        onConfirm={confirmRestore}
        onWithdraw={() => setRite(null)}
      />
      <RiteConfirm
        visible={rite === "strike"}
        title="THE RECORD WILL BE STRUCK"
        body="EVERY VIGIL, EVERY CALL, EVERY EPITHET. THIS IS NOT UNDONE."
        confirmLabel="STRIKE THE RECORD"
        destructive
        onConfirm={confirmStrike}
        onWithdraw={() => setRite(null)}
      />
    </Screen>
  );
}
