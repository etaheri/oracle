import { MILESTONE_COPY } from "@oracle/core";
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
import { LITURGY_LINES, SCORE_GLOSS, calibrationVerdict } from "@oracle/core";
import { shieldStat } from "../game/shieldStat";
import { scoreValue } from "../game/scoreProgress";
import { standingLine } from "../game/standing";

// The plaque's floor, shared by the frame that waits for it. The loading
// frame exists so the plaque fills rather than flashes, and it only earns
// that if the two are the same size: at 280 the frame still visibly grew
// when the record landed. This is the loaded plaque's own height — its
// padding, the epithet block, the rule, the lead stat, the score gloss
// beneath it and six supporting rows — so the only step left is the epithet
// wrapping to a second line or the claim row being offered, both of which are
// the record's own news. Raised from 380 when the gloss was added: it is two
// lines of size-10 mono plus its gap at ordinary text sizes.
const PLAQUE_MIN_H = 420;

// Seven rows at one size read as seven equal facts. The Oracle Score is the
// headline — it is the number the epithet is derived from — so it takes the
// temple voice and its own rule, and the six supporting stats stay machine
// voice beneath it (refinement spec §7).
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space(3) }}>
      <Mono size={11} color={colors.mutedInk} letterSpacing={2} style={{ flexShrink: 1 }}>{label}</Mono>
      <Mono size={11} color={colors.ink} letterSpacing={2} style={{ flexShrink: 1, textAlign: "right" }}>{value}</Mono>
    </View>
  );
}

// The lead treatment celebrates a number you have earned, so it only applies
// to one. Before fifty calls are rated `scoreValue` returns a progress
// sentence — "UNWRITTEN · 0 OF 50" — and at Ritual 20 that ran straight
// through its own label and off the plaque's edge. A sentence is not a
// headline: unearned, the row keeps the machine voice the six stats below it
// use, and only the real score gets carved.
function LeadStat({ label, value }: { label: string; value: string }) {
  const earned = /^\d+$/.test(value);
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space(3) }}>
      <Mono size={11} color={colors.goldText} letterSpacing={2} style={{ flexShrink: 1 }}>{label}</Mono>
      {earned ? (
        <Ritual bold size={20} color={colors.ink} letterSpacing={1}>{value}</Ritual>
      ) : (
        <Mono size={11} color={colors.goldText} letterSpacing={2} style={{ flexShrink: 1, textAlign: "right" }}>{value}</Mono>
      )}
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
        router.dismissTo("/");
      }
    })();
  };

  const confirmStrike = () => {
    setRite(null);
    void (async () => {
      const ok = await strikeRecord();
      if (!ok) return;
      // Every cached answer belonged to a record that no longer exists.
      // Without this the struck player lands on a Home still showing their
      // old vigil and epithet until each query happens to refetch.
      qc.clear();
      router.dismissTo("/");
    })();
  };

  const d = ledger.data ?? null;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

  async function handleShare() {
    if (!d) return;
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
    // Scrolls, because this column is taller than the glass whenever the claim
    // row is offered — which is every unclaimed player, i.e. every new
    // install. Centred inside a fixed box, that overflow pushed the title up
    // over ‹ RETURN and dropped STRIKE THE RECORD off the bottom. Screen's
    // scroll variant keeps the centring for a short record and grows for a
    // long one; see its own note for why flexGrow is the load-bearing part.
    <Screen scroll header={<TopBar />}>
      <View style={{ flexGrow: 1, justifyContent: "center", gap: space(4), paddingVertical: space(4) }}>
        <Eyebrow>The forecaster&apos;s ledger</Eyebrow>
        {/* One column in both states. The frame used to be the only thing
            held steady while the six children below it did not exist yet —
            so the plaque itself stayed the right size and still jumped
            ~115pt upward, because a centred column half the height centres
            differently. The furniture below is static; only the plaque's
            interior depends on the record. */}
        <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold, padding: space(5), gap: space(4), minHeight: PLAQUE_MIN_H, ...(d ? null : { alignItems: "center", justifyContent: "center" }) }}>
          {d ? (
            <>
              <Eyebrow>Epithet of the last 28 days</Eyebrow>
              <View style={{ alignItems: "center", gap: space(2) }}>
                <Ritual bold size={24} color={colors.ink} letterSpacing={3} style={{ textAlign: "center" }}>{d.epithet.title}</Ritual>
                <Mono size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>{d.epithet.receipt}</Mono>
              </View>
              <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.4 }} />
              <View style={{ gap: space(2) }}>
                {d.milestones.map(id => <Mono key={id} size={11} style={{ textAlign: "center" }}>{MILESTONE_COPY[id]}</Mono>)}
                <LeadStat label="ORACLE SCORE" value={scoreValue(d.oracle_score, d.calls_rated)} />
                {/* The machine's own plaque row, on the same fifty-call floor
                    the player meets -- so for its first ten days it too reads
                    UNWRITTEN beside them (schema comment, MeLedgerSchema.oracle). */}
                <LeadStat label="THE ORACLE" value={scoreValue(d.oracle.score, d.oracle.calls_rated)} />
                {/* The score is the premise of the whole app — the ledger naming
                    who can actually see — and it used to sit here as a bare label
                    over a progress string that never said what fifty was fifty OF
                    (audit 2026-09-02 §1.1). One line, in the row's own register:
                    how it is earned while it is unwritten, what it measures once
                    it is. The second half is also the legal wall, stated to the
                    player rather than only to the spec. */}
                <Mono size={10} color={colors.mutedInk} letterSpacing={1} style={{ lineHeight: 16 }}>
                  {d.oracle_score === null ? "FIFTY RATED CALLS WRITE YOUR SCORE. COMPLETE EVERY NON-VOID QUESTION; AT LEAST THREE MUST RESOLVE. OLDER ROUNDS REQUIRED ALL FIVE." : SCORE_GLOSS.written}
                </Mono>
                {standingLine(d.percentile, d.cohort_size) && (
                  <Mono size={10} color={colors.goldText} letterSpacing={2} style={{ lineHeight: 16 }}>
                    {standingLine(d.percentile, d.cohort_size)}
                  </Mono>
                )}
                {d.oracle.days_compared > 0 && (
                  <Mono size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>
                    {`YOU HAVE OUTSEEN THE ORACLE ON ${d.oracle.days_outseen} OF ${d.oracle.days_compared} DAYS`}
                  </Mono>
                )}
                <View style={{ height: 1, backgroundColor: colors.lineSoft, marginVertical: space(1) }} />
                <Stat label="DAYS CONSULTED" value={String(d.days_consulted)} />
                <Stat label="CURRENT VIGIL" value={`${d.streak} ${d.streak === 1 ? "DAY" : "DAYS"}`} />
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
              <View style={{ minHeight: 78, justifyContent: "center", marginTop: space(2) }}>
                {d.claimed ? (
                  <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>
                    THE RECORD IS CLAIMED
                  </Mono>
                ) : appleAvailable ? (
                  <View style={{ alignItems: "center", gap: space(2) }}>
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
            </>
          ) : (
            <>
              <AsciiDust />
              <DecodeLine text="THE LEDGER IS CONSULTED" cursor size={10} color={colors.goldText} letterSpacing={4} style={{ textAlign: "center" }} />
            </>
          )}
        </View>
        {!plusActive && <QuietLink title="Oracle plus" onPress={() => router.push("/plus")} />}
        <View style={{ gap: space(1) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={10} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </View>
        <GoldButton title={sharing ? "PREPARING…" : "DECLARE YOURSELF"} onPress={handleShare} disabled={!d} />
        {shareError && (
          <Mono size={10} color={colors.vermilion} letterSpacing={2} style={{ textAlign: "center" }}>{shareError}</Mono>
        )}
        <QuietLink title="Strike the record" onPress={() => setRite("strike")} />
        {d && <PlaqueShareCanvas canvasRef={canvasRef} data={d} />}
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
