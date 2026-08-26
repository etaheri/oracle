import { useEffect } from "react";
import { useMineToday } from "../api/hooks";
import { useRoundStore } from "./roundStore";

// Plan-3 carry-over: the in-memory store resets on relaunch, so the server is
// the source of truth for what this player has sealed today. Anti-herding is
// unaffected — /today/mine returns only the caller's own predictions.
export function useHydratePlayedState(enabled: boolean) {
  const mine = useMineToday(enabled);
  const hydrate = useRoundStore((s) => s.hydrate);
  useEffect(() => {
    if (mine.data && mine.data.predictions.length > 0) hydrate(mine.data.predictions);
  }, [mine.data, hydrate]);
}
