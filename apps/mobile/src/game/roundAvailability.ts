export function roundAvailability(questions: Array<{ id: string; locks_at: string; lock_healed?: boolean }>, sealedIds: ReadonlySet<string>, nowMs: number, version = 1) {
  const remaining = questions.filter(q => !sealedIds.has(q.id) && !(version >= 2 && q.lock_healed));
  const open = remaining.filter(q => Date.parse(q.locks_at) > nowMs);
  const missedCount = remaining.length - open.length;
  return { openCount: open.length, missedCount, earliestOpenLock: open.map(q => q.locks_at).sort()[0] ?? null,
    completeStillPossible: questions.length > 0 && missedCount === 0 && (version < 2 || questions.filter(q => !q.lock_healed).length >= 3) };
}
