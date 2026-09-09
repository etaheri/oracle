import { create } from "zustand";

export function makeIdempotencyKey(qid: string): string {
  return `${qid}:${Math.random().toString(36).slice(2, 10)}`;
}

interface Entry { answer: boolean; confidence: number; sealed: boolean; idempotencyKey: string; atSeal?: { pct: number; count: number } }
interface RoundState {
  answers: Record<string, Entry>;
  setAnswer(qid: string, answer: boolean): void;
  setConfidence(qid: string, confidence: number): void;
  markSealed(qid: string): void;
  hydrate(predictions: ReadonlyArray<{ question_id: string; answer: boolean; confidence: number }>): void;
  // The crowd at the instant this question was sealed (design 2026-09-09
  // §4.1) — arrives later, from /today/mine, once the seal has round-tripped
  // the server. Merges onto whatever entry already exists; never touches
  // `sealed` or `answer`, so it can be applied safely on every refetch.
  setAtSeal(qid: string, snap: { pct: number; count: number }): void;
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
  setAtSeal: (qid, snap) => set((s) => s.answers[qid] ? ({ answers: { ...s.answers, [qid]: { ...s.answers[qid]!, atSeal: snap } } }) : s),
  hydrate: (predictions) => set((s) => {
    const answers = { ...s.answers };
    for (const p of predictions) {
      const existing = answers[p.question_id];
      // Server is the source of truth (Plan-3 carry-over): a server-known
      // prediction is sealed, and its answer/confidence overwrite any local
      // draft or divergent replay.
      answers[p.question_id] = {
        answer: p.answer,
        confidence: p.confidence,
        sealed: true,
        idempotencyKey: existing?.idempotencyKey ?? makeIdempotencyKey(p.question_id),
      };
    }
    return { answers };
  }),
  reset: () => set({ answers: {} }),
}));
