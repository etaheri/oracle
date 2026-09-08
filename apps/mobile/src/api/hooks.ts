import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RoundTodaySchema, RoundNextSchema, RevealSchema, RoundBoardSchema, CrowdSoFarSchema, MineTodaySchema, MeLedgerSchema, SubmitResSchema, ExhibitionSchema, type PredictionSubmit } from "@oracle/core";
import { api, ApiError } from "./client";
import { getDeviceToken } from "./auth";

export function useToday() {
  return useQuery({
    queryKey: ["round", "today"],
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api("/v1/round/today", RoundTodaySchema, { token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useNextRound(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "next"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api("/v1/round/next", RoundNextSchema, { token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useExhibition(enabled: boolean) {
  return useQuery({
    queryKey: ["exhibition"],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api("/v1/round/exhibition", ExhibitionSchema, { token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useCrowdSoFar(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "crowd"],
    enabled,
    refetchInterval: 10_000,
    queryFn: async () => api("/v1/round/today/crowd", CrowdSoFarSchema, { token: await getDeviceToken() }),
  });
}

export function useMineToday(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "mine"],
    enabled,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api("/v1/round/today/mine", MineTodaySchema, { token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useReveal(date: string | null) {
  return useQuery({
    queryKey: ["reveal", date],
    enabled: date !== null,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api(`/v1/round/${date}/reveal`, RevealSchema, { token });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 409 || e.status === 404)) return { pending: true } as const;
        throw e;
      }
    },
  });
}

// The day's board, read beside the reveal it belongs to. 409 (the day is not
// fully read) and 404 (no such round) both mean "there is no board here yet",
// which the reveal renders as an empty reserved slot rather than an error --
// the reveal itself is already saying what state the day is in.
export function useRoundBoard(date: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["board", date],
    enabled: date !== null && enabled,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api(`/v1/round/${date}/board`, RoundBoardSchema, { token });
      } catch (e) {
        if (e instanceof ApiError && (e.status === 409 || e.status === 404)) return null;
        throw e;
      }
    },
  });
}

export function useMeLedger() {
  return useQuery({
    queryKey: ["me", "ledger"],
    queryFn: async () => {
      const token = await getDeviceToken();
      return api("/v1/me/ledger", MeLedgerSchema, { token });
    },
  });
}

export function useSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: PredictionSubmit) =>
      api("/v1/predictions", SubmitResSchema, { method: "POST", body: JSON.stringify(p), token: await getDeviceToken() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["round", "crowd"] });
      qc.invalidateQueries({ queryKey: ["round", "mine"] });
    },
  });
}
