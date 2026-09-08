import { roundAvailability } from "../game/roundAvailability";
import { shouldOfferReminder } from "../game/reminderOffer";
import { useNotificationPermission } from "../notifications/permission";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View, Pressable, Linking } from "react-native";
import { Screen } from "../ui/Screen";
import { Mono, role } from "../ui/Text";
import { SystemHeader } from "../ui/SystemHeader";
import { FooterNav, type NavItem } from "../ui/FooterNav";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton } from "../ui/Button";
import { LivingHero } from "../ui/LivingHero";
import { MaterializeTitle } from "../ui/MaterializeTitle";
import { OracleClock } from "../ui/OracleClock";
import { HomeChallenge } from "../ui/HomeChallenge";
import { useQueryClient } from "@tanstack/react-query";
import { useToday, useCrowdSoFar, useMeLedger, useNextRound, useReveal } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { useHydratePlayedState } from "../game/useHydratePlayedState";
import { crowdLean } from "../game/orbMood";
import { isBootDone, isOrbLanded, onBootDone, onOrbLanded } from "../game/bootGate";
import { useHeroCues } from "../ui/useHeroCues";
import { shieldNotice } from "../game/shieldNotice";
import { rescueOffered } from "../game/rescueOffer";
import { revealReady } from "../game/revealReady";
import { riskLine, lapseNotice } from "../game/homeLines";
import { arrivalInputForRound, arrivalState } from "../game/arrivalState";
import { beginHomeAction, invalidateHomeAction, ownsHomeAction, type HomeActionGate } from "../game/homeActionGate";
import { msUntil } from "../game/countdown";
import { useNow } from "../game/useNow";
import { getOrbGreeted, getRevealSeen, getRitesSeen, markOrbGreeted } from "../api/flags";
import { resealReminders } from "../notifications/schedule";
import { maybeSummon, summonNow } from "../notifications/summons";
import { purchaseRescue } from "../monetization/purchases";
import { usePlusStore } from "../monetization/plusState";
import { capture } from "../analytics/analytics";
import { vigilLine, COPY_BANK, CURRENT_GAME_COPY, GAME_TERMS, PAYWALL_CTA_LINES, REMINDER_CTA_LINES, type MeLedger } from "@oracle/core";
import { colors, space, ROW_H } from "../theme";
import { dateStamp } from "../game/dateStamp";
import { useFocusEffect, useRouter } from "expo-router";
import { useChromeScale } from "../ui/useChromeScale";
import { scaledRow } from "../game/typeScaling";

// The rescue offer at the breaking point (revenue-rites spec): the line has
// no {streak} token (verbatim per copy bank), so no fillSlots is needed here.
const RESCUE_LINE = COPY_BANK.find((l) => l.id === "paywall.rescue-1")!.text;
const RESCUE_CONFIRM_LINE = COPY_BANK.find((l) => l.id === "streak.shield-1")!.text;
const STORE_SILENT_LINE = "THE STORE DID NOT ANSWER. NOTHING WAS CHARGED.";
// The store took the purchase but the shield has not reached the ledger yet:
// it is granted server-side by the RevenueCat webhook, so there is a real gap
// between "charged" and "protected". Printing the confirmation across that gap
// told the player they were safe before anything made them safe (audit
// 2026-09-02 §4.2). This line is true in the gap, and the ledger's own row is
// the thing that eventually says otherwise.
const STORE_PENDING_LINE = "THE STORE ANSWERED. THE LEDGER WILL RECORD IT SHORTLY.";
const SHIELD_LANDING_TRIES = 3;
const SHIELD_LANDING_GAP_MS = 2000;

// The call's reserved height: two rows of state line and the framed action.
// Home used to be a plain column, so every query that resolved — the round,
// the ledger, yesterday's reveal — changed the bottom stack's height and
// shoved the hero, wordmark and epigraph up the screen. The slot is this tall
// from the first frame and its contents bottom-align inside it. It scales
// with the OS text size, because the rows inside it do (spec §4).
function callSlotHeight(scale: number) {
  return scaledRow(ROW_H.line, scale) * 2 + space(3) + Math.ceil(48 * scale);
}

function yesterdayOf(date: string | undefined): string {
  const base = date ? new Date(`${date}T00:00:00Z`) : new Date();
  return new Date(base.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export default function Index() {
  const today = useToday();
  const answers = useRoundStore((s) => s.answers);
  const router = useRouter();
  const actionGate = useRef<HomeActionGate>({ generation: 0, pending: false, focused: true });
  const [checkingArrival, setCheckingArrival] = useState(false);
  const invalidateArrivalAction = useCallback((focused: boolean) => {
    actionGate.current = invalidateHomeAction(actionGate.current, focused);
    setCheckingArrival(false);
  }, []);
  const leaveHome = useCallback((navigate: () => void) => {
    invalidateArrivalAction(false);
    navigate();
  }, [invalidateArrivalAction]);
  const chromeScale = useChromeScale();
  // The state row reserves two printed lines. Most days it prints one — "THE
  // PROPHECY IS SEALED" — but the partial-day line ("3 OF 5 SEALED · THE DAY
  // RATES ONLY WHEN ALL FIVE ARE SEALED.") wraps, and sealing a single answer
  // should not move the temple when you come back to it.
  const noticeRowH = scaledRow(ROW_H.meta, chromeScale);

  const round = today.data;
  const availabilityNow = useNow(1000);
  const localSealedIds = new Set(round?.questions.filter(q => answers[q.id]?.sealed).map(q => q.id) ?? []);
  const hydration = useHydratePlayedState(!!round, round?.date ?? null);
  const sealedIds = new Set([...localSealedIds, ...hydration.sealedQuestionIds]);
  const availability = round ? roundAvailability(round.questions, sealedIds, availabilityNow, round.rules_version) : null;
  const requiredQuestions = round?.questions.filter((question) => !(round.rules_version >= 2 && question.lock_healed)) ?? [];
  const submittedFromData = requiredQuestions.length > 0 && requiredQuestions.every((question) => sealedIds.has(question.id));
  const needsNext = !round || (availability?.openCount === 0 && !submittedFromData);
  const sealedCount = round ? round.questions.filter((q) => answers[q.id]?.sealed).length : 0;
  // Fires once per day's round, the moment it first renders live (still
  // open) here — not on every 30s re-render from the risk-line clock below.
  const openedFor = useRef<string | null>(null);
  const yesterday = yesterdayOf(round?.date);
  const reveal = useReveal(yesterday);
  const playedYesterday = reveal.data && !("pending" in reveal.data) ? reveal.data.questions.some((q) => q.my !== null) : null;
  const [revealSeen, setRevealSeen] = useState<string | null>(null);
  const [ritesSeen, setRitesSeen] = useState<boolean | undefined>(undefined);
  const anySealed = !!round && round.questions.some((q) => answers[q.id]?.sealed);
  // Home never remounts under the Stack (back-nav from /reveal or /rites just
  // refocuses it), so re-read both flags on every focus, not just on mount.
  useFocusEffect(
    useCallback(() => {
      void getRevealSeen().then(setRevealSeen);
      void getRitesSeen().then(setRitesSeen);
      // The local reminder schedule is rewritten here rather than in a plain
      // effect on the round data. resealReminders returns early without
      // notification permission, and the ONLY moment permission is ever
      // granted is the summons — which is pushed from this very screen and
      // dismissed back onto it. On a data-only trigger the day-one player
      // granted permission and then had nothing reschedule, so their first
      // closing call and first noon knock were never written, and whether
      // they got any reminders at all came down to which control they used to
      // leave the round (audit 2026-09-02 §5.3). Focus covers that return,
      // and the round values in the deps below still cover every data change
      // while focused — strictly more than the old effect did.
      if (round?.locks_at) void resealReminders(round.locks_at, round.date, sealedCount);
      // The one summons, ever (voice spec §4), and this is now its only
      // trigger. The round screen used to ask on the fifth seal, which put
      // the OS permission prompt straight over the crowd finale; asking on
      // any focus after a first seal lands it after the crowd has been
      // beheld, and still catches the partial player who never returns to a
      // finished spread.
      if (anySealed) void maybeSummon((href) => router.push(href));
    }, [anySealed, router, round?.date, round?.locks_at, sealedCount])
  );
  useFocusEffect(
    useCallback(() => {
      actionGate.current = invalidateHomeAction(actionGate.current, true);
      return () => invalidateArrivalAction(false);
    }, [invalidateArrivalAction])
  );
  const showLedgerCta = revealReady(reveal.data) && playedYesterday === true && revealSeen !== yesterday;
  const crowd = useCrowdSoFar(anySealed);
  const lean = crowdLean(crowd.data?.questions ?? []);
  const next = useNextRound(!today.isLoading && needsNext);
  const arrivalInput = arrivalInputForRound(round, sealedIds, availabilityNow, {
    loading: today.isLoading || (needsNext && next.isLoading),
    failed: today.isError || hydration.failed || (needsNext && next.isError),
    hydrated: ritesSeen !== undefined && hydration.hydrated,
    firstVisit: ritesSeen === false,
    nextOpensAt: next.data?.opens_at ?? null,
  });
  const arrival = arrivalState(arrivalInput);
  const allSealed = arrival.kind === "submitted";
  useEffect(() => {
    if (round && (arrival.kind === "live" || arrival.kind === "partial") && openedFor.current !== round.date) {
      openedFor.current = round.date;
      capture("round_opened", { date: round.date });
    }
  }, [arrival.kind, round]);
  const ledger = useMeLedger();
  const vigil = vigilLine(ledger.data?.streak ?? 0, `home:${round?.date ?? ""}`);
  const shield = shieldNotice(ledger.data?.shield_used_on ?? null, yesterday);
  // Re-evaluated every 30s so the risk line can appear without a remount —
  // Home never remounts under the Stack (see the focus effect above).
  const now = useNow(30_000);
  const risk = riskLine(ledger.data?.streak ?? 0, anySealed, msUntil(round?.locks_at ?? null, now), `risk:${round?.date ?? ""}`);
  const lapse = lapseNotice(ledger.data?.days_consulted ?? 0, ledger.data?.streak ?? 0, playedYesterday, `lapse:${yesterday}`);
  // The summons only ever fires after a seal, so a reader who answers nothing
  // is never asked for permission — and is exactly who a reminder is for.
  // This is that reader's only door; see game/reminderOffer.ts.
  const notifPermission = useNotificationPermission();
  const reminderOffer = shouldOfferReminder({
    openCount: availability?.openCount ?? 0,
    anySealed,
    permission: notifPermission,
  });
  const notice = shield ?? risk ?? lapse ?? vigil;
  // Risk/lapse notices are the paywall's entry point — a missed vigil is the
  // one moment protection actually matters. Shield/vigil lines stay plain.
  const noticeLinksToPlus = notice !== null && (notice === risk || notice === lapse);
  // The one-row rescue offer: only below an ACTUAL risk notice (not when a
  // shield notice from yesterday is taking priority). Every other condition
  // — the streak floor a shield will actually defend, an existing
  // subscription, a shield already in reserve — lives in rescueOffer.ts,
  // where it is tested against settleStreak itself.
  const plusActive = usePlusStore((s) => s.plusActive);
  const showRescue = !!ledger.data && rescueOffered({
    atRisk: notice === risk && risk !== null,
    streak: ledger.data.streak,
    plusActive,
    freeShieldAvailable: ledger.data.free_shield_available,
    paidShields: ledger.data.paid_shields,
  });
  const [rescueResult, setRescueResult] = useState<"idle" | "waiting" | "success" | "pending" | "error">("idle");
  const qc = useQueryClient();

  const refreshArrivalQueries = useCallback(async () => {
    await Promise.all([today.refetch(), hydration.refetch(), next.refetch()]);
  }, [today.refetch, hydration.refetch, next.refetch]);

  useEffect(() => {
    const transitionAt = availability?.earliestOpenLock ?? (needsNext ? next.data?.opens_at : null);
    if (!transitionAt) return;
    const delay = Date.parse(transitionAt) - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => { void refreshArrivalQueries(); }, Math.min(delay + 25, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [availability?.earliestOpenLock, needsNext, next.data?.opens_at, refreshArrivalQueries]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshArrivalQueries();
    });
    return () => subscription.remove();
  }, [refreshArrivalQueries]);

  const arrivalEvent = useRef<string | null>(null);
  useEffect(() => {
    if (arrival.kind === "loading") return;
    const key = `${arrival.kind}:${arrivalInput.hasRound}:${arrivalInput.firstVisit}`;
    if (arrivalEvent.current === key) return;
    arrivalEvent.current = key;
    capture("arrival_viewed", { state: arrival.kind, first_visit: arrivalInput.firstVisit, has_schedule: arrivalInput.hasRound || !!arrivalInput.nextOpensAt });
  }, [arrival.kind, arrivalInput.firstVisit, arrivalInput.hasRound, arrivalInput.nextOpensAt]);
  const doRescue = useCallback(async () => {
    setRescueResult("waiting");
    const shieldsNow = () => qc.getQueryData<MeLedger>(["me", "ledger"])?.paid_shields ?? 0;
    const before = shieldsNow();
    if (!(await purchaseRescue())) { setRescueResult("error"); return; }
    // The shield is granted by the RevenueCat webhook, not by the purchase
    // call, so it arrives on the server's schedule. Watch the ledger for it
    // rather than asserting it: only a shield we can actually SEE in reserve
    // earns the confirmation line.
    for (let i = 0; i < SHIELD_LANDING_TRIES; i++) {
      await qc.refetchQueries({ queryKey: ["me", "ledger"] });
      if (shieldsNow() > before) { setRescueResult("success"); return; }
      if (i < SHIELD_LANDING_TRIES - 1) await new Promise((r) => setTimeout(r, SHIELD_LANDING_GAP_MS));
    }
    setRescueResult("pending");
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

  const openExhibition = useCallback(() => {
    leaveHome(() => router.push({ pathname: "/practice", params: { entry_point: "waiting_home" } }));
  }, [leaveHome, router]);
  const resolveArrivalAtPress = useCallback(async () => {
    const [todayResult, hydrationResult] = await Promise.all([
      today.refetch(),
      hydration.refetch(true),
    ]);
    const freshRound = todayResult.data;
    const failed = todayResult.isError || !hydrationResult.ok;
    const currentAnswers = useRoundStore.getState().answers;
    const freshSealedIds = new Set([
      ...(freshRound?.questions.filter((question) => currentAnswers[question.id]?.sealed).map((question) => question.id) ?? []),
      ...hydrationResult.sealedQuestionIds,
    ]);
    const input = arrivalInputForRound(freshRound, freshSealedIds, Date.now(), {
      loading: false,
      failed,
      hydrated: true,
      firstVisit: ritesSeen === false,
      nextOpensAt: next.data?.opens_at ?? null,
    });
    return { input, state: arrivalState(input) };
  }, [hydration.refetch, next.data?.opens_at, ritesSeen, today.refetch]);
  const performArrivalAction = useCallback(async () => {
    const started = beginHomeAction(actionGate.current);
    if (!started) return;
    actionGate.current = started.gate;
    setCheckingArrival(true);
    try {
      const fresh = await resolveArrivalAtPress();
      if (!ownsHomeAction(actionGate.current, started.token) || fresh.state.kind === "error") return;
      if (fresh.state.primary === "live") {
        leaveHome(() => router.push(ritesSeen ? "/round" : "/rites"));
      } else if (fresh.state.primary === "crowd") {
        leaveHome(() => router.push("/round"));
      } else if (fresh.state.primary === "exhibition") {
        openExhibition();
      }
    } finally {
      if (ownsHomeAction(actionGate.current, started.token)) invalidateArrivalAction(true);
    }
  }, [invalidateArrivalAction, leaveHome, openExhibition, resolveArrivalAtPress, ritesSeen, router]);
  const stampDate = round?.date ?? new Date().toISOString().slice(0, 10);
  // The day's first arrival: the orb ripples once, unprompted, a beat after
  // it lands. `undefined` while the flag reads — greeting on an unread flag
  // would fire it every single launch. The orb greets at most once per mount
  // whatever this does, so stampDate settling from the fallback to the
  // round's own date cannot produce a second one.
  const [greetedOn, setGreetedOn] = useState<string | null | undefined>(undefined);
  useEffect(() => { void getOrbGreeted().then(setGreetedOn); }, []);
  const greetOrb = greetedOn !== undefined && greetedOn !== stampDate;
  useEffect(() => { if (greetOrb) void markOrbGreeted(stampDate); }, [greetOrb, stampDate]);
  // Yesterday's ledger keeps a rail slot only while it is not already the
  // screen's headline action.
  const navItems: NavItem[] = [
    { label: "YOUR LEDGER", a11yLabel: "The forecaster's ledger", onPress: () => leaveHome(() => router.push("/ledger")) },
    ...(showLedgerCta ? [] : [{ label: "YESTERDAY", a11yLabel: "Yesterday's ledger", onPress: () => leaveHome(() => router.push(`/reveal/${yesterday}`)) }]),
    { label: GAME_TERMS.rulesNav.toUpperCase(), a11yLabel: GAME_TERMS.rulesNav, onPress: () => leaveHome(() => router.push({ pathname: "/rites", params: { all: "1" } })) },
  ];

  return (
    <Screen scroll header={<SystemHeader stamp={dateStamp(stampDate)} />} footer={<FooterNav items={navItems} />}>
      {/* The temple register: hero, wordmark, clock. Centred in whatever the
          reserved call slot below leaves it, so it is at its final position on
          the first frame and stays there whatever resolves later. */}
      <View style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", gap: space(5), paddingVertical: space(4) }}>
        {/* Temple moment: the near-touch, alive — transparent loop over the
            museum ground, glow tinted by the crowd's mood. */}
        <LivingHero lean={lean} playerCount={round?.player_count ?? 0} phase={heroPhase} greet={greetOrb} />
        <Mono {...role.meta} color={colors.mutedInk} accessibilityLabel={`The Oracle. ${CURRENT_GAME_COPY.opponentChallenge}`}>{`THE ORACLE · ${CURRENT_GAME_COPY.opponentChallenge.toUpperCase()}`}</Mono>
        {/* The wordmark materializes out of ASCII (patina spec phase 2) and
            settles into carved stillness with a faint edge residue. */}
        <MaterializeTitle active={cues.title} />
        {/* The live line: what the oracle is doing, right now. */}
        <OracleClock round={arrival.kind === "waiting" ? null : round} allSealed={allSealed} loading={today.isLoading} active={cues.subtitle} nextQuestionClosesAt={availability?.earliestOpenLock ?? null} />
      </View>
      <View style={{ gap: space(3) }}>
        <View style={{ minHeight: callSlotHeight(chromeScale), justifyContent: "flex-end", gap: space(3) }}>
          {showLedgerCta && (
            <>
              <DecodeLine active={booted} text="YESTERDAY'S LEDGER IS READ" {...role.line} color={colors.goldText} />
              <GoldButton title="READ THE LEDGER" onPress={() => leaveHome(() => router.push(`/reveal/${yesterday}`))} />
            </>
          )}
          <HomeChallenge
            state={arrival}
            input={arrivalInput}
            active={booted}
            secondary={showLedgerCta}
            checking={checkingArrival}
            onPrimary={() => {
              if (arrival.primary === "exhibition") openExhibition();
              else if (arrival.primary === "crowd") leaveHome(() => router.push("/round"));
              else void performArrivalAction();
            }}
            onRetry={() => { void refreshArrivalQueries(); }}
            onExhibition={openExhibition}
          />
        </View>
        {/* The notice rides the ledger query and lands long after first paint —
            this is the row that used to arrive and shove everything above it.
            The slot exists from frame one whether or not there is a line. */}
        <View style={{ minHeight: noticeRowH, justifyContent: "center" }}>
          {notice && (
            noticeLinksToPlus ? (
              // hitSlop, not minHeight: the notice keeps its one reserved row
              // while the tap target reaches 44pt. The underline is the only
              // thing separating a notice you can act on from one that is just
              // the machine talking — it is free now that the footer rail has
              // stopped underlining everything.
              <Pressable accessibilityRole="button" hitSlop={{ top: 15, bottom: 15, left: 24, right: 24 }} onPress={() => leaveHome(() => router.push("/plus"))}>
                <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textDecorationLine: "underline" }]}>{notice}</Mono>
              </Pressable>
            ) : (
              <Mono {...role.meta} color={colors.mutedInk}>{notice}</Mono>
            )
          )}
        </View>
        {/* The reminder door, one row below the notice and reserved on the
            same terms: the permission read is async and lands after first
            paint, so the slot has to exist from frame one or it shoves the
            composition the moment the OS answers — the same bug the notice
            row above is reserved against. Empty whenever notifications are
            already on, which is the common case. */}
        <View style={{ minHeight: noticeRowH, justifyContent: "center" }}>
          {reminderOffer && (
            <Pressable
              accessibilityRole="button"
              hitSlop={{ top: 15, bottom: 15, left: 24, right: 24 }}
              onPress={() =>
                reminderOffer === "settings"
                  // Refused once, iOS will not prompt again — Settings is the
                  // only switch left, and pretending otherwise would give the
                  // reader a button that silently does nothing.
                  ? void Linking.openSettings()
                  // summonNow, not a bare push: it marks the flag, so a
                  // reader who enables notifications here is not summoned
                  // again the first time they seal a question.
                  : leaveHome(() => void summonNow(() => router.push("/summons")))
              }
            >
              <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textDecorationLine: "underline" }]}>
                {reminderOffer === "settings" ? REMINDER_CTA_LINES.settings : REMINDER_CTA_LINES.ask}
              </Mono>
            </Pressable>
          )}
        </View>
        {/* The block outlives its own offer. The instant a shield lands,
            `showRescue` goes false — there is one in reserve now — so the
            confirmation used to flash and vanish in the same frame as the
            thing it was confirming. Anything the machine has to say about a
            purchase stays until the player moves on. */}
        {(showRescue || rescueResult !== "idle") && (
          <View style={{ gap: space(2), alignItems: "center" }}>
            <Mono {...role.meta} color={rescueResult === "success" ? colors.goldText : colors.mutedInk}>
              {rescueResult === "success"
                ? RESCUE_CONFIRM_LINE
                : rescueResult === "pending"
                  ? STORE_PENDING_LINE
                  : rescueResult === "error"
                    ? STORE_SILENT_LINE
                    : RESCUE_LINE}
            </Mono>
            {(rescueResult === "idle" || rescueResult === "error") && (
              <GoldButton title={PAYWALL_CTA_LINES.rescue} onPress={doRescue} />
            )}
            {rescueResult === "waiting" && (
              <Mono {...role.meta} color={colors.mutedInk}>CONSULTING THE STORE…</Mono>
            )}
          </View>
        )}
      </View>
    </Screen>
  );
}
