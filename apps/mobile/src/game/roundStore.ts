import { create } from "zustand";

export function makeIdempotencyKey(qid: string): string {
  return `${qid}:${Math.random().toString(36).slice(2, 10)}`;
}

// `stake` is the server's frozen stake once the seal has round-tripped (null
// before, and on an unstaked round). `doubled` arrives from /today/mine after
// the tray places the double (design 2026-09-14 §5.3).
interface Entry { answer: boolean; sealed: boolean; idempotencyKey: string; stake: number | null; doubled: boolean; atSeal?: { pct: number; count: number } }
interface RoundState {
  answers: Record<string, Entry>;
  setAnswer(qid: string, answer: boolean): void;
  markSealed(qid: string, stake: number | null): void;
  hydrate(predictions: ReadonlyArray<{ question_id: string; answer: boolean; stake?: number | null; doubled?: boolean }>): void;
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
          sealed: existing?.sealed ?? false,
          idempotencyKey: existing?.idempotencyKey ?? makeIdempotencyKey(qid),
          stake: existing?.stake ?? null,
          doubled: existing?.doubled ?? false,
          answer,
        },
      },
    };
  }),
  markSealed: (qid, stake) => set((s) => s.answers[qid] ? ({ answers: { ...s.answers, [qid]: { ...s.answers[qid]!, sealed: true, stake } } }) : s),
  setAtSeal: (qid, snap) => set((s) => s.answers[qid] ? ({ answers: { ...s.answers, [qid]: { ...s.answers[qid]!, atSeal: snap } } }) : s),
  hydrate: (predictions) => set((s) => {
    const answers = { ...s.answers };
    for (const p of predictions) {
      const existing = answers[p.question_id];
      // Server is the source of truth: a server-known prediction is sealed,
      // and its answer, stake and double overwrite any local draft. `atSeal`
      // is setAtSeal's field and survives untouched.
      answers[p.question_id] = {
        ...existing,
        answer: p.answer,
        sealed: true,
        stake: p.stake ?? null,
        doubled: p.doubled ?? false,
        idempotencyKey: existing?.idempotencyKey ?? makeIdempotencyKey(p.question_id),
      };
    }
    return { answers };
  }),
  reset: () => set({ answers: {} }),
}));
