import { GAME_TERMS, MILESTONE_COPY } from "@oracle/core";
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
  const earned = /^\d+$/.test(value);
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
      await shareSnapshot(canvasRef, "oracle-plaque.png", plaqueMessage(d.epithet.title));
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
        <Eyebrow>Your ledger</Eyebrow>
        <Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>Your predictions and results</Mono>
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
              <Eyebrow>Epithet of the last 28 days</Eyebrow>
              <View style={{ alignItems: "center", gap: space(2) }}>
                <Ritual bold size={displayScale.epithet} color={colors.ink} letterSpacing={3} style={{ textAlign: "center" }}>{d.epithet.title}</Ritual>
                <Mono {...role.meta} color={colors.goldText}>{d.epithet.receipt}</Mono>
              </View>
              <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.4 }} />
              <View style={{ gap: space(2) }}>
                {d.milestones.map(id => <Mono key={id} {...role.line} color={colors.mutedInk}>{MILESTONE_COPY[id]}</Mono>)}
                <LeadStat label="YOUR FORECAST RATING" value={scoreValue(d.oracle_score, d.calls_rated)} />
                {/* The machine's own plaque row, on the same fifty-call floor
                    the player meets -- so for its first ten days it too reads
                    UNWRITTEN beside them (schema comment, MeLedgerSchema.oracle). */}
                <LeadStat label="ORACLE RATING" value={scoreValue(d.oracle.score, d.oracle.calls_rated)} />
                {/* The score is the premise of the whole app — the ledger naming
                    who can actually see — and it used to sit here as a bare label
                    over a progress string that never said what fifty was fifty OF
                    (audit 2026-09-02 §1.1). One line, in the row's own register:
                    how it is earned while it is unwritten, what it measures once
                    it is. The second half is also the legal wall, stated to the
                    player rather than only to the spec. */}
                {/* One gloss register on this plaque. This row used to be
                    tracked caps at role.caption while the vigil's gloss eight
                    rows below was sentence case at role.supporting — the same
                    job, in two voices, inside one screenful. Its unwritten
                    copy also lived here as a call-site literal, which is how
                    it came to name the fifty without ever scaling it against
                    the five a day the rest of the app says. */}
                <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "left" }]}>
                  {d.oracle_score === null ? SCORE_GLOSS.unwritten : SCORE_GLOSS.written}
                </Mono>
                {standingLine(d.percentile, d.cohort_size) && (
                  <Mono {...role.meta} color={colors.goldText} style={[role.meta.style, { textAlign: "left" }]}>
                    {standingLine(d.percentile, d.cohort_size)}
                  </Mono>
                )}
                {d.oracle.days_compared > 0 && (
                  <Mono {...role.meta} color={colors.goldText}>
                    {`YOU HAVE OUTSEEN THE ORACLE ON ${d.oracle.days_outseen} OF ${d.oracle.days_compared} DAYS`}
                  </Mono>
                )}
                <View style={{ height: 1, backgroundColor: colors.lineSoft, marginVertical: space(1) }} />
                <Stat label="ROUNDS PLAYED" value={String(d.days_consulted)} />
                <Stat label="STREAK" value={`${d.streak} ${d.streak === 1 ? "DAY" : "DAYS"}`} />
                {/* A gloss on the row above it, in the register a gloss is
                    written in. It used to sit two rows higher, sentence case
                    and size 12, between tracked-caps stat rows that gave the
                    eye no signal that the voice had changed. */}
                <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { paddingBottom: space(1) }]}>Your vigil is your playing streak: a reason to make one call each day. The count updates when the round settles. Shields can hold it through a missed round. Your rating comes from your forecasts; your streak adds no points.</Mono>
                <Stat label="ACCURACY" value={pct(d.accuracy_pct)} />
                <Stat label="AVG CONFIDENCE" value={pct(d.avg_confidence)} />
                <Stat label="AGAINST THE TIDE" value={`×${d.tide_wins}`} />
                <Stat label="SHIELDS IN RESERVE" value={shieldStat(d.free_shield_available, d.paid_shields)} />
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
              <DecodeLine text="THE LEDGER IS CONSULTED" cursor {...role.eyebrow} color={colors.goldText} />
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
        body="EVERY VIGIL, EVERY CALL, EVERY EPITHET. THIS IS NOT UNDONE."
        confirmLabel="STRIKE THE RECORD"
        destructive
        onConfirm={confirmStrike}
        onWithdraw={() => setRite(null)}
      />
    </Screen>
  );
}
