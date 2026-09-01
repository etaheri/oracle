import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { Screen } from "../ui/Screen";
import { Mono, role } from "../ui/Text";
import { SystemHeader } from "../ui/SystemHeader";
import { FooterNav, type NavItem } from "../ui/FooterNav";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { LivingHero } from "../ui/LivingHero";
import { MaterializeTitle } from "../ui/MaterializeTitle";
import { OracleClock } from "../ui/OracleClock";
import { useQueryClient } from "@tanstack/react-query";
import { useToday, useCrowdSoFar, useMeLedger, useReveal } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { crowdLean } from "../game/orbMood";
import { isBootDone, isOrbLanded, onBootDone, onOrbLanded } from "../game/bootGate";
import { useHeroCues } from "../ui/useHeroCues";
import { shieldNotice } from "../game/shieldNotice";
import { revealReady } from "../game/revealReady";
import { partialLine, spokenLine, riskLine, lapseNotice } from "../game/homeLines";
import { msUntil } from "../game/countdown";
import { useNow } from "../game/useNow";
import { getRevealSeen, getRitesSeen } from "../api/flags";
import { resealReminders } from "../notifications/schedule";
import { maybeSummon } from "../notifications/summons";
import { purchaseRescue } from "../monetization/purchases";
import { usePlusStore } from "../monetization/plusState";
import { capture } from "../analytics/analytics";
import { vigilLine, COPY_BANK, PAYWALL_CTA_LINES } from "@oracle/core";
import { colors, space, ROW_H } from "../theme";
import { dateStamp } from "../game/dateStamp";
import { useFocusEffect, useRouter } from "expo-router";

// The rescue offer at the breaking point (revenue-rites spec): the line has
// no {streak} token (verbatim per copy bank), so no fillSlots is needed here.
const RESCUE_LINE = COPY_BANK.find((l) => l.id === "paywall.rescue-1")!.text;
const RESCUE_CONFIRM_LINE = COPY_BANK.find((l) => l.id === "streak.shield-1")!.text;
const STORE_SILENT_LINE = "THE STORE DID NOT ANSWER. NOTHING WAS CHARGED.";

// The call's reserved height: two rows of state line and the framed action. Home used to be a plain column, so every query that
// resolved — the round, the ledger, yesterday's reveal — changed the bottom
// stack's height and shoved the hero, wordmark and epigraph up the screen
// (~50px when `today` landed, again when the notice arrived). The slot is this
// tall from the first frame and its contents bottom-align inside it, so the
// common day's arrival moves nothing above it.
const CALL_SLOT_H = ROW_H.line * 2 + space(3) + 48;

// The state row reserves two printed lines. Most days it prints one — "THE
// PROPHECY IS SEALED" — but the partial-day line ("3 OF 5 SEALED · THE DAY
// RATES ONLY WHEN ALL FIVE ARE SEALED.") wraps, and sealing a single answer
// should not move the temple when you come back to it.
function StateRow({ children }: { children: React.ReactNode }) {
  return <View style={{ minHeight: ROW_H.line * 2, justifyContent: "flex-end" }}>{children}</View>;
}

function yesterdayOf(date: string | undefined): string {
  const base = date ? new Date(`${date}T00:00:00Z`) : new Date();
  return new Date(base.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export default function Index() {
  const today = useToday();
  const answers = useRoundStore((s) => s.answers);
  const router = useRouter();

  const round = today.data;
  const allSealed = !!round && round.questions.length > 0 && round.questions.every((q) => answers[q.id]?.sealed);
  const sealedCount = round ? round.questions.filter((q) => answers[q.id]?.sealed).length : 0;
  const partial = round ? partialLine(sealedCount, round.questions.length) : null;
  useEffect(() => {
    if (round?.locks_at) void resealReminders(round.locks_at, round.date, sealedCount);
  }, [round?.date, round?.locks_at, sealedCount]);
  // Fires once per day's round, the moment it first renders live (still
  // open) here — not on every 30s re-render from the risk-line clock below.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (round && !allSealed && openedFor.current !== round.date) {
      openedFor.current = round.date;
      capture("round_opened", { date: round.date });
    }
  }, [round, allSealed]);
  const yesterday = yesterdayOf(round?.date);
  const reveal = useReveal(yesterday);
  const playedYesterday = reveal.data && !("pending" in reveal.data) ? reveal.data.questions.some((q) => q.my !== null) : null;
  const [revealSeen, setRevealSeen] = useState<string | null>(null);
  const [ritesSeen, setRitesSeen] = useState(true); // optimistic: never flash the gate at a veteran
  const anySealed = !!round && round.questions.some((q) => answers[q.id]?.sealed);
  // Home never remounts under the Stack (back-nav from /reveal or /rites just
  // refocuses it), so re-read both flags on every focus, not just on mount.
  useFocusEffect(
    useCallback(() => {
      void getRevealSeen().then(setRevealSeen);
      void getRitesSeen().then(setRitesSeen);
      // Covers the partial player: round.tsx only fires the summons on the
      // full seal, so someone who never returns to a finished spread is
      // still asked here, once, on any focus after their first seal.
      if (anySealed) void maybeSummon((href) => router.push(href));
    }, [anySealed, router])
  );
  const showLedgerCta = revealReady(reveal.data) && revealSeen !== yesterday;
  const crowd = useCrowdSoFar(anySealed);
  const lean = crowdLean(crowd.data?.questions ?? []);
  useHydratePlayedState(!!round);
  const ledger = useMeLedger();
  const vigil = vigilLine(ledger.data?.streak ?? 0, `home:${round?.date ?? ""}`);
  const shield = shieldNotice(ledger.data?.shield_used_on ?? null, yesterday);
  // Re-evaluated every 30s so the risk line can appear without a remount —
  // Home never remounts under the Stack (see the focus effect above).
  const now = useNow(30_000);
  const risk = riskLine(ledger.data?.streak ?? 0, anySealed, msUntil(round?.locks_at ?? null, now), `risk:${round?.date ?? ""}`);
  const lapse = lapseNotice(ledger.data?.days_consulted ?? 0, ledger.data?.streak ?? 0, playedYesterday, `lapse:${yesterday}`);
  const notice = shield ?? risk ?? lapse ?? vigil;
  // Risk/lapse notices are the paywall's entry point — a missed vigil is the
  // one moment protection actually matters. Shield/vigil lines stay plain.
  const noticeLinksToPlus = notice !== null && (notice === risk || notice === lapse);
  // The one-row rescue offer: only below an ACTUAL risk notice (not when a
  // shield notice from yesterday is taking priority), only when there is no
  // subscription and no shield already in reserve to cover the miss.
  const plusActive = usePlusStore((s) => s.plusActive);
  const noShieldsInReserve = !!ledger.data && !ledger.data.free_shield_available && ledger.data.paid_shields === 0;
  const showRescue = notice === risk && risk !== null && !plusActive && noShieldsInReserve;
  const [rescueResult, setRescueResult] = useState<"idle" | "success" | "error">("idle");
  const qc = useQueryClient();
  const doRescue = useCallback(async () => {
    setRescueResult("idle");
    const ok = await purchaseRescue();
    setRescueResult(ok ? "success" : "error");
    // The bought shield lands in the ledger server-side; without this the
    // notice/rescue row above keeps reading the stale pre-purchase ledger.
    if (ok) void qc.invalidateQueries({ queryKey: ["me", "ledger"] });
  }, [qc]);
  // Cold-start choreography (spec 2026-09-01-boot-orb-handoff). `booted`:
  // the rite's hold elapsed — the bottom-stack lines print now, the hero
  // starts waking. `orbLanded`: the rite's orb arrived — the hero goes live
  // and title/epigraph follow on the cue timers. Both seed from the gate's
  // sync getters so a warm (re)mount renders live on its first frame.
  const [booted, setBooted] = useState(isBootDone);
  useEffect(() => onBootDone(() => setBooted(true)), []);
  const [orbLanded, setOrbLanded] = useState(isOrbLanded);
  useEffect(() => onOrbLanded(() => setOrbLanded(true)), []);
  const heroPhase = orbLanded ? "live" : booted ? "waking" : "cold";
  const cues = useHeroCues(orbLanded);

  const enterRound = useCallback(() => router.push(ritesSeen ? "/round" : "/rites"), [ritesSeen, router]);
  const stampDate = round?.date ?? new Date().toISOString().slice(0, 10);
  // Yesterday's ledger keeps a rail slot only while it is not already the
  // screen's headline action.
  const navItems: NavItem[] = [
    { label: "YOUR LEDGER", a11yLabel: "The forecaster's ledger", onPress: () => router.push("/ledger") },
    ...(showLedgerCta ? [] : [{ label: "YESTERDAY", a11yLabel: "Yesterday's ledger", onPress: () => router.push(`/reveal/${yesterday}`) }]),
    { label: "THE RITES", a11yLabel: "The rites", onPress: () => router.push("/rites") },
  ];

  return (
    <Screen>
      <SystemHeader stamp={dateStamp(stampDate)} />
      {/* The temple register: hero, wordmark, clock. Centred in whatever the
          reserved call slot below leaves it, so it is at its final position on
          the first frame and stays there whatever resolves later. */}
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(5) }}>
        {/* Temple moment: the near-touch, alive — transparent loop over the
            museum ground, glow tinted by the crowd's mood. */}
        <LivingHero lean={lean} playerCount={round?.player_count ?? 0} phase={heroPhase} />
        {/* The wordmark materializes out of ASCII (patina spec phase 2) and
            settles into carved stillness with a faint edge residue. */}
        <MaterializeTitle active={cues.title} />
        {/* The live line: what the oracle is doing, right now. */}
        <OracleClock round={round} allSealed={allSealed} loading={today.isLoading} active={cues.subtitle} />
      </View>
      <View style={{ gap: space(3) }}>
        <View style={{ minHeight: CALL_SLOT_H, justifyContent: "flex-end", gap: space(3) }}>
          {showLedgerCta && (
            <>
              <DecodeLine active={booted} text="YESTERDAY'S LEDGER IS READ" {...role.line} color={colors.goldText} />
              <GoldButton title="READ THE LEDGER" onPress={() => router.push(`/reveal/${yesterday}`)} />
            </>
          )}
          {round && !allSealed && (
            <>
              {/* One gold voice per screen. When yesterday's ledger owns the
                  frame, today's state line steps down to muted chrome rather
                  than stacking a second headline in the same colour beneath
                  the first. */}
              <StateRow>
                <DecodeLine
                  active={booted}
                  text={partial ?? spokenLine(round.player_count)}
                  {...(showLedgerCta ? role.meta : role.line)}
                  color={showLedgerCta ? colors.mutedInk : colors.goldText}
                />
              </StateRow>
              {showLedgerCta ? (
                <QuietLink title="Enter today's round" onPress={enterRound} />
              ) : (
                <GoldButton title="ENTER" onPress={enterRound} />
              )}
            </>
          )}
          {round && allSealed && (
            <>
              <StateRow>
                <DecodeLine
                  active={booted}
                  text="THE PROPHECY IS SEALED"
                  {...(showLedgerCta ? role.meta : role.line)}
                  color={showLedgerCta ? colors.mutedInk : colors.goldText}
                />
              </StateRow>
              {showLedgerCta ? (
                <QuietLink title="Behold the crowd" onPress={() => router.push("/round")} />
              ) : (
                <GoldButton title="BEHOLD THE CROWD" onPress={() => router.push("/round")} />
              )}
            </>
          )}
          {!round && !today.isLoading && (
            <StateRow>
              <DecodeLine active={booted} text="THE ORACLE SLEEPS" cursor {...role.line} color={colors.mutedInk} />
            </StateRow>
          )}
        </View>
        {/* The notice rides the ledger query and lands long after first paint —
            this is the row that used to arrive and shove everything above it.
            The slot exists from frame one whether or not there is a line. */}
        <View style={{ minHeight: ROW_H.meta, justifyContent: "center" }}>
          {notice && (
            noticeLinksToPlus ? (
              // hitSlop, not minHeight: the notice keeps its one reserved row
              // while the tap target reaches 44pt. The underline is the only
              // thing separating a notice you can act on from one that is just
              // the machine talking — it is free now that the footer rail has
              // stopped underlining everything.
              <Pressable accessibilityRole="button" hitSlop={{ top: 15, bottom: 15, left: 24, right: 24 }} onPress={() => router.push("/plus")}>
                <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textDecorationLine: "underline" }]}>{notice}</Mono>
              </Pressable>
            ) : (
              <Mono {...role.meta} color={colors.mutedInk}>{notice}</Mono>
            )
          )}
        </View>
        {showRescue && (
          <View style={{ gap: space(2), alignItems: "center" }}>
            <Mono {...role.meta} color={rescueResult === "success" ? colors.goldText : colors.mutedInk}>
              {rescueResult === "success" ? RESCUE_CONFIRM_LINE : rescueResult === "error" ? STORE_SILENT_LINE : RESCUE_LINE}
            </Mono>
            {rescueResult !== "success" && <GoldButton title={PAYWALL_CTA_LINES.rescue} onPress={doRescue} />}
          </View>
        )}
      </View>
      {/* The footer rail. Space divides it from the notice above, not a rule —
          the brief asks for very restrained borders, and the brackets already
          say these are controls. */}
      <View style={{ marginTop: space(4) }}>
        <FooterNav items={navItems} />
      </View>
    </Screen>
  );
}
