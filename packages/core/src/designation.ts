// How the board names a player who has not been named by the ledger.
//
// ASSIGNED, not chosen, and derived from the user id -- so nothing a person
// typed is ever stored or rendered, and the board carries no user-generated
// content, no report path, and no moderation surface.
//
// STABLE ACROSS DAYS ON PURPOSE. A designation that changed nightly would be
// cheaper to generate and worth far less: the point is that a stranger who
// beat you three days running becomes a rival you never agreed to have.
//
// A designation is meaningless by construction. An EPITHET is earned and
// carries a receipt. The ledger records everyone and names only those it can
// prove -- see epithet.ts for the half that must be earned.

const MODIFIERS = [
  "PATIENT", "COLD", "RESTLESS", "SILENT", "STEADY", "DISTANT", "QUIET", "SEVERE",
  "FAITHFUL", "DOUBTING", "EARLY", "LATE", "STUBBORN", "CAREFUL", "SPARING", "EXACT",
  "SLOW", "SUDDEN", "PLAIN", "GRAVE", "MILD", "CERTAIN", "UNEASY", "MEASURED",
  "WAKEFUL", "SOBER", "NARROW", "OBSTINATE", "TEMPERATE", "UNHURRIED",
] as const;

const ROLES = [
  "SCRIBE", "WITNESS", "HAND", "READER", "AUGUR", "WATCHER", "KEEPER", "VOICE",
  "CLERK", "STEWARD", "COUNTER", "MARKER", "TALLY", "REGISTRAR", "ARCHIVIST",
  "SIGNATORY", "ATTENDANT", "PROCTOR", "AUDITOR", "NOTARY",
] as const;

/** The machine's own row on the board. Never assigned to a player. */
export const ORACLE_DESIGNATION = "THE ORACLE";

// Deterministic 32-bit string hash. Same char-walk shape epigraph.ts uses;
// it needs to spread, not to be cryptographic.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function designation(userId: string): string {
  const h = hash(userId);
  // Two independent draws from one hash: the low bits pick the role, the
  // high bits the modifier, so ids adjacent in the low bits still differ.
  const role = ROLES[h % ROLES.length]!;
  const modifier = MODIFIERS[Math.floor(h / ROLES.length) % MODIFIERS.length]!;
  return `THE ${modifier} ${role}`;
}

const SUFFIXES = ["", " II", " III", " IV", " V", " VI", " VII", " VIII"];

/**
 * Within one rendered window only. The pool is not large enough to guarantee
 * global uniqueness and does not try to be -- a reader only ever sees a
 * handful of rows, so repeats are resolved where they are visible.
 */
export function disambiguate(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return `${name}${SUFFIXES[Math.min(n, SUFFIXES.length - 1)] ?? ""}`;
  });
}
