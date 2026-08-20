import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RoundTodaySchema, RevealSchema, CrowdSoFarSchema, type PredictionSubmit } from "@oracle/core";
import { z } from "zod";
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

export function useCrowdSoFar(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "crowd"],
    enabled,
    refetchInterval: 10_000,
    queryFn: async () => api("/v1/round/today/crowd", CrowdSoFarSchema, { token: await getDeviceToken() }),
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
        if (e instanceof ApiError && e.status === 409) return { pending: true } as const;
        throw e;
      }
    },
  });
}

const SubmitResSchema = z.object({ id: z.string(), first_hour: z.boolean() });

export function useSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: PredictionSubmit) =>
      api("/v1/predictions", SubmitResSchema, { method: "POST", body: JSON.stringify(p), token: await getDeviceToken() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["round", "crowd"] });
    },
  });
}
