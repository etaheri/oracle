// The machine voice (spec: docs/superpowers/specs/2026-08-26-oracle-voice-design.md).
// Hand-written, linted, versioned. No generated copy — the meme value of a
// voice comes from one unmistakable register sustained for years.

export type Requirement = "results" | "tideWin" | "streak" | "players" | "lapsed" | "wrong" | "partial";

export interface CopyLine {
  id: string;
  pool: "noon" | "closing" | "streak" | "system";
  text: string;
  requires?: ReadonlyArray<Requirement>;
}

export const LITURGY_LINES = [
  "EVERY ANSWER SEALED BEFORE THE OUTCOME.",
  "EVERY SCORE READ AGAINST THE CROWD. NOTHING REVISED.",
] as const;
export const LITURGY = LITURGY_LINES.join(" ");

export function fillSlots(text: string, slots: { n?: number; streak?: number }): string {
  return text
    .replace(/\{n\}/g, slots.n === undefined ? "{n}" : String(slots.n))
    .replace(/\{streak\}/g, slots.streak === undefined ? "{streak}" : String(slots.streak));
}

export const COPY_BANK: ReadonlyArray<CopyLine> = [
  // ── noon: the hinge. Ledger read; the pull, never the payoff. ──
  { id: "noon.generic-1", pool: "noon", text: "THE LEDGER IS READ. IT DOES NOT READ ITSELF TWICE." },
  { id: "noon.generic-2", pool: "noon", text: "NOON HAS PASSED. THE OUTCOMES BELONG TO THE LEDGER NOW." },
  { id: "noon.generic-3", pool: "noon", text: "THE LEDGER IS READ. THE CROWD IS COUNTING ITS WOUNDS." },
  { id: "noon.generic-4", pool: "noon", text: "WHAT WAS SEALED IS NOW SETTLED." },
  { id: "noon.generic-5", pool: "noon", text: "THE ORB HAS SPOKEN. THE LEDGER AGREES." },
  { id: "noon.read-1", pool: "noon", text: "THE LEDGER IS READ. {n} OF YOUR ANSWERS DID NOT SURVIVE.", requires: ["results", "wrong"] },
  { id: "noon.read-2", pool: "noon", text: "THE LEDGER IS READ. ONE OF YOUR ANSWERS SURPRISED US.", requires: ["results"] },
  { id: "noon.read-3", pool: "noon", text: "THE CROWD MOVED. YOU DID NOT. THE LEDGER REMEMBERS WHO WAS RIGHT.", requires: ["results"] },
  { id: "noon.read-4", pool: "noon", text: "NOON HAS PASSED. YOUR CONVICTION HAS BEEN WEIGHED.", requires: ["results"] },
  { id: "noon.read-5", pool: "noon", text: "THE OUTCOMES ARE IN. YOUR LEDGER HAS CHANGED SHAPE.", requires: ["results"] },
  { id: "noon.read-6", pool: "noon", text: "THE CROWD CHOSE ITS SIDES. SO DID YOU. THE LEDGER KNOWS WHO CHOSE WELL.", requires: ["results"] },
  { id: "noon.read-7", pool: "noon", text: "FIVE QUESTIONS WERE ASKED. THE ANSWERS ARE NO LONGER YOURS TO CHOOSE.", requires: ["results"] },
  { id: "noon.read-8", pool: "noon", text: "THE LEDGER IS READ. IT DOES NOT FLATTER. IT DOES NOT LIE.", requires: ["results"] },
  { id: "noon.read-9", pool: "noon", text: "YOUR ANSWERS MET THEIR OUTCOMES AT NOON. NOT ALL OF THEM STOOD.", requires: ["results", "wrong"] },
  { id: "noon.read-10", pool: "noon", text: "THE INK IS DRY. THE LEDGER HOLDS YOUR RECKONING.", requires: ["results"] },
  { id: "noon.tide-1", pool: "noon", text: "YOU STOOD AGAINST THE TIDE. THE TIDE BROKE.", requires: ["tideWin"] },
  { id: "noon.tide-2", pool: "noon", text: "THE CROWD WENT ONE WAY. YOU WENT THE OTHER. THE LEDGER BOWED TO YOU.", requires: ["tideWin"] },
  { id: "noon.tide-3", pool: "noon", text: "FEW STOOD WHERE YOU STOOD. THE LEDGER PAID A BOUNTY.", requires: ["tideWin"] },
  { id: "noon.lapsed-1", pool: "noon", text: "THE LEDGER WAS READ WITHOUT YOU. TOMORROW IT NEED NOT BE.", requires: ["lapsed"] },
  { id: "noon.lapsed-2", pool: "noon", text: "THE CROWD SPOKE. YOUR LINE IS BLANK.", requires: ["lapsed"] },
  { id: "noon.lapsed-3", pool: "noon", text: "NOON CAME AND WENT. THE ORB DID NOT HEAR FROM YOU.", requires: ["lapsed"] },
  { id: "noon.vigil-1", pool: "noon", text: "{streak} DAYS WITHOUT SILENCE. THE ORACLE NOTICES.", requires: ["results", "streak"] },
  { id: "noon.vigil-2", pool: "noon", text: "DAY {streak} OF YOUR VIGIL IS WRITTEN.", requires: ["results", "streak"] },
  { id: "noon.vigil-3", pool: "noon", text: "THE LEDGER IS READ. YOUR VIGIL HOLDS AT {streak} DAYS.", requires: ["results", "streak"] },
  { id: "noon.vigil-4", pool: "noon", text: "ANOTHER NOON, ANOTHER PAGE. {streak} WITHOUT A GAP.", requires: ["results", "streak"] },
  // ── closing: the call. Unsealed players only, hours before lock. ──
  { id: "closing.call-1", pool: "closing", text: "FIVE QUESTIONS. THE ORB IS OPEN UNTIL NOON." },
  { id: "closing.call-2", pool: "closing", text: "THE QUESTIONS ARE POSTED. THE CROWD IS ALREADY MOVING." },
  { id: "closing.call-3", pool: "closing", text: "TODAY'S LEDGER IS BLANK. IT WILL NOT STAY THAT WAY." },
  { id: "closing.call-4", pool: "closing", text: "{n} ORACLES HAVE ALREADY SPOKEN. THE ORB WAITS FOR YOU.", requires: ["players"] },
  { id: "closing.call-5", pool: "closing", text: "THE BIG ONE IS WORTH THE MOST. IT IS ALSO THE HARDEST. THIS IS NOT A COINCIDENCE." },
  { id: "closing.call-6", pool: "closing", text: "THE ORB CLOSES AT NOON. IT DOES NOT REOPEN." },
  { id: "closing.call-7", pool: "closing", text: "THREE HOURS REMAIN. THE CROWD HAS NOT WAITED." },
  { id: "closing.call-8", pool: "closing", text: "YOUR SEAT AT THE LEDGER IS EMPTY. NOON IS COMING." },
  { id: "closing.call-9", pool: "closing", text: "THE CROWD HAS CHOSEN ITS SIDES. YOURS IS STILL UNCLAIMED." },
  { id: "closing.call-10", pool: "closing", text: "PROPHECY FAVORS THE PRESENT. THE ORB IS STILL LIT." },
  { id: "closing.call-11", pool: "closing", text: "FIVE ANSWERS STAND BETWEEN YOU AND NOON." },
  { id: "closing.call-12", pool: "closing", text: "THE QUESTIONS WILL NOT ASK THEMSELVES TWICE." },
  { id: "closing.call-13", pool: "closing", text: "NOON SEALS THE LEDGER WITH OR WITHOUT YOU." },
  { id: "closing.call-14", pool: "closing", text: "THE ORACLE ASKS ONCE A DAY. TODAY IT IS STILL ASKING." },
  { id: "closing.call-15", pool: "closing", text: "WHAT YOU BELIEVE BEFORE NOON BECOMES RECORD AFTER IT." },
  { id: "closing.call-16", pool: "closing", text: "THE CROWD LEANS. IT DOES NOT KNOW YET IF IT LEANS WRONG." },
  { id: "closing.call-17", pool: "closing", text: "AN UNSEALED PROPHECY IS ONLY AN OPINION." },
  { id: "closing.call-18", pool: "closing", text: "THE ORB HOLDS FIVE QUESTIONS AND NO GRUDGES. NOON CHANGES THAT." },
  { id: "closing.call-19", pool: "closing", text: "SPEAK BEFORE NOON OR HOLD YOUR PEACE UNTIL TOMORROW." },
  { id: "closing.call-20", pool: "closing", text: "THE LEDGER TAKES NO LATE ENTRIES." },
  { id: "closing.partial-1", pool: "closing", text: "THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED. NOON IS COMING.", requires: ["partial"] },
  { id: "closing.partial-2", pool: "closing", text: "YOUR PROPHECY IS UNFINISHED. THE LEDGER COUNTS ONLY WHOLE DAYS.", requires: ["partial"] },
  // ── streak: vigil lines for in-app surfaces. ──
  { id: "streak.vigil-1", pool: "streak", text: "{streak} DAYS WITHOUT SILENCE.", requires: ["streak"] },
  { id: "streak.vigil-2", pool: "streak", text: "YOUR VIGIL HOLDS. {streak} DAYS AND COUNTING.", requires: ["streak"] },
  { id: "streak.vigil-3", pool: "streak", text: "THE ORACLE KEEPS COUNT. {streak}.", requires: ["streak"] },
  { id: "streak.vigil-4", pool: "streak", text: "{streak} CONSECUTIVE NOONS. THE LEDGER APPROVES.", requires: ["streak"] },
  { id: "streak.vigil-5", pool: "streak", text: "A VIGIL OF {streak} DAYS IS NOT LUCK.", requires: ["streak"] },
  { id: "streak.lapse-1", pool: "streak", text: "YESTERDAY THE ORB WENT UNCONSULTED. IT DID NOT GO UNREAD." },
  { id: "streak.lapse-2", pool: "streak", text: "A GAP IN THE LEDGER IS NOT THE END OF IT." },
  { id: "streak.lapse-3", pool: "streak", text: "STREAKS END. RECORDS REMAIN." },
  { id: "streak.shield-1", pool: "streak", text: "THE SHIELD HELD. YOUR VIGIL SURVIVES THE MISSED NOON." },
  { id: "streak.begin-1", pool: "streak", text: "BEGIN AGAIN. THE ORB DOES NOT DWELL." },
  { id: "streak.risk-1", pool: "streak", text: "YOUR VIGIL OF {streak} DAYS ENDS AT NOON.", requires: ["streak"] },
  // ── system: states of the machine. ──
  { id: "system.sleep-1", pool: "system", text: "THE ORACLE SLEEPS. NO ROUND IS OPEN." },
  { id: "system.reading-1", pool: "system", text: "THE LEDGER IS BEING READ. PATIENCE." },
  { id: "system.offline-1", pool: "system", text: "THE ORB IS BEYOND REACH. IT WILL RETURN." },
  { id: "system.creed-1", pool: "system", text: "NOTHING IS REVISED. NOTHING IS FORGOTTEN." },
  { id: "system.creed-2", pool: "system", text: "EVERY ANSWER SEALED BEFORE THE OUTCOME." },
] as const;

// Char-walk hash (31-multiplier, 32-bit wrapped): deterministic, and the
// oracle does not change its mind — one seed key, one line, all day.
export function voiceSeed(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function selectLine(
  lines: ReadonlyArray<CopyLine>,
  seedKey: string,
  satisfied: ReadonlyArray<Requirement>,
): CopyLine | null {
  const have = new Set(satisfied);
  const eligible = lines.filter((l) => (l.requires ?? []).every((r) => have.has(r)));
  if (eligible.length === 0) return null;
  return eligible[voiceSeed(seedKey) % eligible.length]!;
}

// The home vigil: one quiet line while a streak holds. Only streak-pool lines
// that REQUIRE a streak are eligible — the lapse/shield lines are for other
// moments. Streak 1 is every first day; the oracle starts counting at 2.
const VIGIL_LINES = COPY_BANK.filter(
  (l) => l.pool === "streak" && (l.requires ?? []).includes("streak") && !l.id.startsWith("streak.risk"),
);

export function vigilLine(streak: number, seedKey: string): string | null {
  if (streak < 2) return null;
  const line = selectLine(VIGIL_LINES, seedKey, ["streak"]);
  return line ? fillSlots(line.text, { streak }) : null;
}

// The Rites: the rules, spoken once before a first seal and kept on a quiet
// link forever. Declaratives only — the machine explains itself the way it
// does everything else. Hand-written, linted, versioned.
export const RITES_LINES = [
  "FIVE QUESTIONS. ONCE A DAY. NOON TO NOON, NEW YORK TIME.",
  "PULL TOWARD YES OR NO. THE LONGER THE PULL, THE GREATER THE CONVICTION. TO RELEASE IS TO SEAL.",
  "AN ANSWER SEALED CANNOT BE UNSEALED.",
  "THE CROWD IS HIDDEN UNTIL YOU COMMIT.",
  "CONVICTION PAYS WHEN RIGHT. IT COSTS MORE WHEN WRONG.",
  "THE BIG ONE COUNTS DOUBLE. IN BOTH DIRECTIONS.",
  "STAND AGAINST THE TIDE AND PREVAIL: THE LEDGER ADDS A BOUNTY.",
  "SEAL ALL FIVE WITHIN THE FIRST HOUR. THE DAY PAYS TEN PERCENT MORE.",
  "SEAL ALL FIVE OR THE DAY DOES NOT RATE. POINTS AND VIGIL STILL COUNT.",
  "MISS A NOON AND THE SHIELD MAY HOLD. ONE IS GRANTED EACH MONTH.",
  "THE LEDGER IS READ AT NOON. NOTHING IS REVISED.",
] as const;

// The Calling: the one-time cinematic on the app's very first open — the
// machine recounts the search and assigns the player their role. Lore only;
// every rule belongs to the rites. Hand-written, linted, versioned.
export const CALLING_LINES = [
  "FOR THIRTY CENTURIES THEY SEARCHED FOR THOSE WHO SEE.",
  "PYTHIA. SIBYL. SEER. EACH CLAIMED THE GIFT. NONE KEPT RECEIPTS.",
  "SO THE LEDGER WAS BUILT. IT DOES NOT BELIEVE. IT RECORDS.",
  "SEALED BEFORE THE OUTCOME. READ WITHOUT MERCY.",
  "THE SEARCH CONTINUES. IT HAS REACHED YOU.",
] as const;

// The partial-day notice (home, when some but not all five are sealed).
export const PARTIAL_LINE = "THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED.";

// The summons: the interstitial before the OS notification prompt (voice
// spec §4). Three declaratives, then the machine asks once.
export const SUMMONS_LINES = [
  "THE ORACLE SPEAKS TWICE A DAY.",
  "ONCE TO ASK. ONCE TO ANSWER.",
  "IT WILL NOT SPEAK MORE THAN THAT.",
] as const;
