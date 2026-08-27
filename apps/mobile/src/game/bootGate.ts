// The boot gate: home's DecodeLines must not print behind the boot-rite
// overlay — they wait for it to lift, so the static resolves in view as the
// overlay fades. Module-level because the rite runs once per process.
let done = false;
const listeners = new Set<() => void>();

export function markBootDone(): void {
  if (done) return;
  done = true;
  listeners.forEach((l) => l());
  listeners.clear();
}

// Calls cb immediately if the rite already ended; otherwise on markBootDone.
// Returns an unsubscribe.
export function onBootDone(cb: () => void): () => void {
  if (done) {
    cb();
    return () => {};
  }
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Test seam only.
export function resetBootGateForTest(): void {
  done = false;
  listeners.clear();
}
