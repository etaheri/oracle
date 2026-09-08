import { useCallback, useEffect, useRef, useState } from "react";
import { useMineToday } from "../api/hooks";
import { useRoundStore } from "./roundStore";

// Plan-3 carry-over: the in-memory store resets on relaunch, so the server is
// the source of truth for what this player has sealed today. Anti-herding is
// unaffected — /today/mine returns only the caller's own predictions.
type HydrationSnapshot = { roundKey: string; failed: boolean; sealedQuestionIds: string[] };

export function useHydratePlayedState(enabled: boolean, roundDate: string | null = null) {
  const mine = useMineToday(enabled);
  const hydrate = useRoundStore((s) => s.hydrate);
  const roundKey = roundDate ?? "enabled-round";
  const [snapshot, setSnapshot] = useState<HydrationSnapshot | null>(null);
  const requestGeneration = useRef(0);
  const currentRoundKey = useRef(roundKey);
  const mounted = useRef(true);
  currentRoundKey.current = roundKey;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  const refetch = useCallback(async (force = false) => {
    if (!enabled && !force) return { ok: true as const, sealedQuestionIds: [] as string[] };
    const requestedRoundKey = roundKey;
    const generation = ++requestGeneration.current;
    const result = await mine.refetch();
    const isCurrent = mounted.current
      && requestGeneration.current === generation
      && currentRoundKey.current === requestedRoundKey;
    if (result.isError) {
      if (isCurrent) setSnapshot({ roundKey: requestedRoundKey, failed: true, sealedQuestionIds: [] });
      return { ok: false as const, sealedQuestionIds: [] as string[] };
    }
    const predictions = result.data?.predictions ?? [];
    const sealedQuestionIds = predictions.map((prediction) => prediction.question_id);
    if (isCurrent) {
      hydrate(predictions);
      setSnapshot({ roundKey: requestedRoundKey, failed: false, sealedQuestionIds });
    }
    return { ok: true as const, sealedQuestionIds };
  }, [enabled, hydrate, mine.refetch, roundKey]);

  useEffect(() => {
    if (!enabled) return;
    setSnapshot(null);
    void refetch();
  }, [enabled, refetch, roundKey]);

  const current = snapshot?.roundKey === roundKey ? snapshot : null;
  return {
    hydrated: !enabled || (current !== null && !current.failed),
    failed: enabled && current?.failed === true,
    sealedQuestionIds: current?.sealedQuestionIds ?? [],
    refetch,
  };
}
