import type { Exhibition } from "@oracle/core";
import type { ArrivalState } from "./arrivalState";

export type ExhibitionPrediction = { answer: boolean; confidence: number };
export type ExhibitionPhase = "choosing" | "sealed" | "revealed";

export type ExhibitionFlow = {
  exhibition: Exhibition;
  phase: ExhibitionPhase;
  prediction: ExhibitionPrediction | null;
  completed: boolean;
};

export function createDepartureGuard() {
  let generation = 0;
  return {
    begin: () => ++generation,
    invalidate: () => { generation += 1; },
    owns: (candidate: number) => candidate === generation,
  };
}

export function chooseExhibition(current: Exhibition | null, candidate: Exhibition): Exhibition {
  return current ?? candidate;
}

export function beginExhibition(exhibition: Exhibition): ExhibitionFlow {
  return { exhibition, phase: "choosing", prediction: null, completed: false };
}

export function sealExhibition(flow: ExhibitionFlow, prediction: ExhibitionPrediction): ExhibitionFlow {
  if (flow.phase !== "choosing") return flow;
  return { ...flow, phase: "sealed", prediction };
}

export function revealExhibition(flow: ExhibitionFlow): { flow: ExhibitionFlow; completedNow: boolean } {
  if (flow.phase !== "sealed" || flow.prediction === null) return { flow, completedNow: false };
  const completedNow = !flow.completed;
  return { flow: { ...flow, phase: "revealed", completed: true }, completedNow };
}

export function retryExhibition(flow: ExhibitionFlow): ExhibitionFlow {
  return { ...flow, phase: "choosing", prediction: null };
}

export function exhibitionExit(state: ArrivalState): { label: string; pathname: "/" | "/round" } {
  if (state.primary === "live") return { label: state.label ?? "PLAY TODAY", pathname: "/round" };
  return { label: "RETURN HOME", pathname: "/" };
}
