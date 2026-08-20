import { create } from "zustand";

export function makeIdempotencyKey(qid: string): string {
  return `${qid}:${Math.random().toString(36).slice(2, 10)}`;
}

interface Entry { answer: boolean; confidence: number; sealed: boolean; idempotencyKey: string }
interface RoundState {
  answers: Record<string, Entry>;
  setAnswer(qid: string, answer: boolean): void;
  setConfidence(qid: string, confidence: number): void;
  markSealed(qid: string): void;
  reset(): void;
}

export const useRoundStore = create<RoundState>((set) => ({
  answers: {},
  setAnswer: (qid, answer) => set((s) => {
    const existing = s.answers[qid];
    return {
      answers: {
        ...s.answers,
        [qid]: {
          confidence: existing?.confidence ?? 75,
          sealed: existing?.sealed ?? false,
          idempotencyKey: existing?.idempotencyKey ?? makeIdempotencyKey(qid),
          answer,
        },
      },
    };
  }),
  setConfidence: (qid, confidence) => set((s) => s.answers[qid] ? ({ answers: { ...s.answers, [qid]: { ...s.answers[qid]!, confidence } } }) : s),
  markSealed: (qid) => set((s) => s.answers[qid] ? ({ answers: { ...s.answers, [qid]: { ...s.answers[qid]!, sealed: true } } }) : s),
  reset: () => set({ answers: {} }),
}));
