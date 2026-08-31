// Per-question lock state (leaky questions lock early, design spec §6). A
// closed, unsealed slot is skipped — the player was late to it — and shown
// struck in the numerals row; it is never dealt.
export function isClosed(q: { locks_at: string }, now: number): boolean {
  return Date.parse(q.locks_at) <= now;
}

export function nextOpenQuestion<Q extends { id: string; slot: number; locks_at: string }>(
  qs: ReadonlyArray<Q>,
  sealed: (id: string) => boolean,
  now: number,
): Q | undefined {
  return [...qs].sort((a, b) => a.slot - b.slot).find((q) => !sealed(q.id) && !isClosed(q, now));
}
