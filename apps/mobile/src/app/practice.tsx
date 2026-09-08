import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { Exhibition } from "@oracle/core";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, role } from "../ui/Text";
import { GoldButton, QuietLink } from "../ui/Button";
import { PracticeCard } from "../ui/PracticeCard";
import { markPracticeSeen, markRitesSeen } from "../api/flags";
import { capture } from "../analytics/analytics";
import { useExhibition, useMineToday, useToday } from "../api/hooks";
import { EXHIBITION_FALLBACK } from "../game/exhibitionFallback";
import { arrivalInputForRound, arrivalState } from "../game/arrivalState";
import { chooseExhibition, createDepartureGuard, exhibitionExit } from "../game/exhibitionFlow";
import { space } from "../theme";

const ENTRY_POINTS = ["first_round", "waiting_home", "how_to_play"] as const;
const EXHIBITION_WAIT_MS = 1_500;
type EntryPoint = typeof ENTRY_POINTS[number];

function entryPoint(value: string | undefined, opening: boolean): EntryPoint {
  return ENTRY_POINTS.includes(value as EntryPoint) ? value as EntryPoint : opening ? "first_round" : "how_to_play";
}

export default function Practice() {
  const router = useRouter();
  const params = useLocalSearchParams<{ opening?: string; entry_point?: string }>();
  const opening = params.opening === "1";
  const source = entryPoint(params.entry_point, opening);
  const remote = useExhibition(true);
  const today = useToday();
  const mine = useMineToday(true);
  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [exiting, setExiting] = useState(false);
  const completed = useRef(false);
  const started = useRef(Date.now());
  const departure = useRef(createDepartureGuard());

  useFocusEffect(useCallback(() => {
    return () => { departure.current.invalidate(); };
  }, []));

  useEffect(() => {
    if (exhibition) return;
    if (!remote.isLoading) {
      setExhibition(current => chooseExhibition(current, remote.data ?? EXHIBITION_FALLBACK));
      return;
    }
    const fallbackTimer = setTimeout(() => {
      setExhibition(current => chooseExhibition(current, EXHIBITION_FALLBACK));
    }, EXHIBITION_WAIT_MS);
    return () => clearTimeout(fallbackTimer);
  }, [exhibition, remote.data, remote.isLoading]);

  useEffect(() => {
    if (!exhibition) return;
    const props = { entry_point: source, content_kind: exhibition.kind, example_id: exhibition.id };
    capture("practice_started", props);
    return () => { if (!completed.current) capture("practice_skipped", props); };
  }, [exhibition, source]);

  const currentState = arrivalState(arrivalInputForRound(
    today.data,
    new Set(mine.data?.predictions.map(prediction => prediction.question_id) ?? []),
    Date.now(),
    {
      loading: today.isLoading || mine.isLoading,
      failed: today.isError || mine.isError,
      hydrated: !mine.isLoading && !mine.isError,
      firstVisit: opening,
      nextOpensAt: null,
    },
  ));
  const currentExit = exhibitionExit(currentState);

  const leave = useCallback(async () => {
    if (exiting) return;
    const generation = departure.current.begin();
    setExiting(true);
    try {
      const [round, answers] = await Promise.all([today.refetch(), mine.refetch()]);
      if (!departure.current.owns(generation)) return;
      const state = arrivalState(arrivalInputForRound(
        round.data,
        new Set(answers.data?.predictions.map(prediction => prediction.question_id) ?? []),
        Date.now(),
        {
          loading: false,
          failed: round.isError || answers.isError,
          hydrated: !answers.isError,
          firstVisit: opening,
          nextOpensAt: null,
        },
      ));
      const exit = exhibitionExit(state);
      if (opening) await markRitesSeen();
      if (!departure.current.owns(generation)) return;
      departure.current.invalidate();
      router.replace(exit.pathname);
    } catch {
      if (!departure.current.owns(generation)) return;
      departure.current.invalidate();
      router.replace("/");
    } finally {
      if (departure.current.owns(generation)) setExiting(false);
    }
  }, [exiting, mine, opening, router, today]);

  const finish = useCallback(() => {
    if (completed.current || !exhibition) return;
    completed.current = true;
    capture("practice_completed", {
      elapsed_ms: Date.now() - started.current,
      entry_point: source,
      content_kind: exhibition.kind,
      example_id: exhibition.id,
    });
    void markPracticeSeen();
  }, [exhibition, source]);

  const returnHome = useCallback(() => {
    departure.current.invalidate();
    router.replace("/");
  }, [router]);

  const liveExit = currentExit.pathname === "/round";
  const footer = <View style={{ gap: space(1) }}>
    <GoldButton
      title={liveExit && exiting ? "CHECKING TODAY…" : currentExit.label}
      disabled={liveExit && exiting}
      onPress={liveExit ? () => { void leave(); } : returnHome}
    />
    {liveExit && <QuietLink title="RETURN HOME" onPress={returnHome} />}
  </View>;

  return <Screen header={<TopBar />} footer={footer}>
    <Stack.Screen options={{ gestureEnabled: false }} />
    <View style={{ flex: 1, minHeight: 0, gap: space(3), paddingTop: space(3) }}>
      <Eyebrow>Exhibition · nothing is recorded</Eyebrow>
      {exhibition
        ? <PracticeCard exhibition={exhibition} onCompleted={finish} />
        : <View style={{ flex: 1, justifyContent: "center" }}><Mono {...role.supporting} style={[role.supporting.style, { textAlign: "center" }]}>PREPARING AN EXHIBITION…</Mono></View>}
    </View>
  </Screen>;
}
