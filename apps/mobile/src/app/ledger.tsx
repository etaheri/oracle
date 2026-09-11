import { FORTUNE, GAME_TERMS } from "@oracle/core";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCanvasRef } from "@shopify/react-native-skia";
import * as AppleAuthentication from "expo-apple-authentication";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual, role } from "../ui/Text";
import { AsciiDust } from "../ui/TerminalPatina";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { RiteConfirm } from "../ui/RiteConfirm";
import { PlaqueShareCanvas } from "../ui/PlaqueShareCard";
import { shareSnapshot } from "../ui/ShareCard";
import { useMeLedger } from "../api/hooks";
import { plaqueMessage } from "../game/sharePattern";
import { appleClaim, appleRestore, strikeRecord } from "../api/identity";
import { usePlusStore } from "../monetization/plusState";
import { colors, space, displayScale } from "../theme";
import { LITURGY_LINES, SCORE_GLOSS } from "@oracle/core";
import { ConfidenceHistory } from "../ui/ConfidenceHistory";
import { shieldStat } from "../game/shieldStat";
import { scoreValue } from "../game/scoreProgress";
import { fortuneHistoryLines } from "../game/fortuneHistory";
import { formatFortune } from "../game/fortuneText";

// The plaque's floor, shared by the frame that waits for it. The loading
// frame exists so the plaque fills rather than flashes, and it only earns
// that if the two are the same size: at 280 the frame still visibly grew
// when the record landed. This is the loaded plaque's own height — its
// padding, the fortune row and its history lines, the two rules, the streak
// rows, the calibration rows and the score gloss — so the only step left is
// a long fortune history or the claim row being offered, both of which are
// the record's own news. Raised from 380 when the gloss was added: it is two
// lines of size-10 mono plus its gap at ordinary text sizes.
const PLAQUE_MIN_H = 420;

// Rows at one size read as equal facts. Fortune and the forecast rating are
// the headlines — they take the temple voice and their own carved numeral —
// and the supporting stats stay machine voice beneath them (refinement spec
// §7).
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space(3) }}>
      <Mono {...role.line} color={colors.mutedInk} style={[role.line.style, { flexShrink: 1, textAlign: "left" }]}>{label}</Mono>
      <Mono {...role.line} color={colors.ink} style={[role.line.style, { flexShrink: 1, textAlign: "right" }]}>{value}</Mono>
    </View>
  );
}

// The lead treatment celebrates a number you have earned, so it only applies
// to one. An earned score is a row: the label left, the carved number right.
// An unearned one is NOT — "UNWRITTEN · 0 OF 50" is a progress reading, and set
// opposite a label in a space-between row both halves wrapped and their
// second lines landed beside each other, so "ORACLE RATING" against its own
// value read as four fragments in two ragged columns. Stacked, the pair reads
// as one fact at any width and at any text size, which is what the row could
// never promise.
function LeadStat({ label, value }: { label: string; value: string }) {
  const earned = /^[\d,]+$/.test(value);
  if (!earned) {
    return (
      <View style={{ gap: space(1) }}>
        <Mono {...role.line} color={colors.goldText} style={[role.line.style, { textAlign: "left" }]}>{label}</Mono>
        <Mono {...role.line} color={colors.goldText} style={[role.line.style, { textAlign: "left" }]}>{value}</Mono>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space(3) }}>
      <Mono {...role.line} color={colors.goldText} style={[role.line.style, { flexShrink: 1, textAlign: "left" }]}>{label}</Mono>
      <Ritual bold size={displayScale.lead} color={colors.ink} letterSpacing={1}>{value}</Ritual>
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
      // old fortune and streak until each query happens to refetch.
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
      await shareSnapshot(canvasRef, "oracle-plaque.png", plaqueMessage(d.fortune ?? FORTUNE.FOUNDING));
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
    <Screen scroll overlayHeader patina header={<TopBar />}>
      <View style={{ flexGrow: 1, justifyContent: "center", gap: space(4), paddingVertical: space(4) }}>
        <Eyebrow>{GAME_TERMS.history}</Eyebrow>
        <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>Your fortune, your streak, your calibration</Mono>
        <QuietLink title={GAME_TERMS.rulesNav} onPress={() => router.push({ pathname: "/rites", params: { all: "1" } })} />
        {/* One column in both states. The frame used to be the only thing
            held steady while the six children below it did not exist yet —
            so the plaque itself stayed the right size and still jumped
            ~115pt upward, because a centred column half the height centres
            differently. The furniture below is static; only the plaque's
            interior depends on the record. */}
        <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold, padding: space(5), gap: space(4), minHeight: PLAQUE_MIN_H, ...(d ? null : { alignItems: "center", justifyContent: "center" }) }}>
          {d ? (
            <>
              <View style={{ gap: space(2) }}>
                <LeadStat label="FORTUNE" value={d.fortune === null ? "UNSETTLED" : formatFortune(d.fortune)} />
                {fortuneHistoryLines(d.fortune_history).map((line) => (
                  <Mono key={line} {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>{line}</Mono>
                ))}
                {d.fortune_history.length === 0 && (
                  <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "left" }]}>Your first settled round writes the first row here.</Mono>
                )}
                <View style={{ height: 1, backgroundColor: colors.lineSoft, marginVertical: space(1) }} />
                <Stat label="ROUNDS PLAYED" value={String(d.days_consulted)} />
                <Stat label="STREAK" value={`${d.streak} ${d.streak === 1 ? "DAY" : "DAYS"}`} />
                {/* A gloss on the row above it, in the register a gloss is
                    written in. */}
                <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { paddingBottom: space(1) }]}>Your streak is one call a day. It updates when the round settles. Streak protection can carry it through a missed round. It adds no fortune.</Mono>
                <Stat label="STREAK PROTECTION" value={shieldStat(d.free_shield_available, d.paid_shields)} />
                <View style={{ height: 1, backgroundColor: colors.lineSoft, marginVertical: space(1) }} />
                <Eyebrow>Your calibration</Eyebrow>
                <LeadStat label="YOUR FORECAST RATING" value={scoreValue(d.oracle_score, d.calls_rated)} />
                {/* The score is the premise of the whole app — the record naming
                    who can actually see — and it used to sit here as a bare label
                    over a progress string that never said what fifty was fifty OF
                    (audit 2026-09-02 §1.1). One line, in the row's own register:
                    how it is earned while it is unwritten, what it measures once
                    it is. The second half is also the legal wall, stated to the
                    player rather than only to the spec. */}
                <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "left" }]}>
                  {d.oracle_score === null ? SCORE_GLOSS.unwritten : SCORE_GLOSS.written}
                </Mono>
                <Stat label="ACCURACY" value={pct(d.accuracy_pct)} />
                <Stat label="AVG CONFIDENCE" value={pct(d.avg_confidence)} />
                {d.confidence_history && <ConfidenceHistory history={d.confidence_history} />}
              </View>
              <View style={{ minHeight: 78, justifyContent: "center", marginTop: space(2) }}>
                {d.claimed ? (
                  <Mono {...role.meta} color={colors.mutedInk}>THE RECORD IS CLAIMED</Mono>
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
              <DecodeLine text="THE RECORD IS CONSULTED" cursor {...role.eyebrow} color={colors.goldText} />
            </>
          )}
        </View>
        {!plusActive && <QuietLink title="Outseen Plus" onPress={() => router.push("/plus")} />}
        <View style={{ gap: space(1) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} {...role.meta} color={colors.mutedInk}>{line}</Mono>
          ))}
        </View>
        <GoldButton title={sharing ? "PREPARING…" : "DECLARE YOURSELF"} onPress={handleShare} disabled={!d} />
        {shareError && (
          <Mono {...role.meta} color={colors.vermilion} accessibilityRole="alert">{shareError}</Mono>
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
        body="EVERY STREAK, EVERY CALL, EVERY STAKE. THIS IS NOT UNDONE."
        confirmLabel="STRIKE THE RECORD"
        destructive
        onConfirm={confirmStrike}
        onWithdraw={() => setRite(null)}
      />
    </Screen>
  );
}
