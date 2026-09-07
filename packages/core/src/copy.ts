// The machine voice (spec: docs/superpowers/specs/2026-08-26-oracle-voice-design.md).
// Hand-written, linted, versioned. No generated copy — the meme value of a
// voice comes from one unmistakable register sustained for years.

export type Requirement = "results" | "tideWin" | "streak" | "players" | "lapsed" | "wrong" | "partial";

export interface CopyLine {
  id: string;
  pool: "noon" | "closing" | "streak" | "system" | "paywall";
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
  // ── paywall: the shield offer. Protection, never pressure. No CTA verbs here —
  // button labels live in PAYWALL_CTA_LINES by construction. ──
  { id: "paywall.creed-1", pool: "paywall", text: "A SHIELD HOLDS A VIGIL OF THREE DAYS OR MORE THROUGH ONE MISSED NOON." },
  { id: "paywall.creed-2", pool: "paywall", text: "THE ORACLE GRANTS ONE EACH MONTH. PLUS ADDS THREE SHIELDS A PERIOD, TO A RESERVE OF FIVE." },
  { id: "paywall.creed-3", pool: "paywall", text: "A KEPT VIGIL WEIGHS EVERY DAY YOU PLAY, IN BOTH DIRECTIONS." },
  { id: "paywall.creed-4", pool: "paywall", text: "THE VIGIL IS FRAGILE. THE SHIELD IS NOT." },
  { id: "paywall.rescue-1", pool: "paywall", text: "YOUR VIGIL ENDS AT NOON. ONE SHIELD WOULD HOLD IT.", requires: ["streak"] },
  { id: "paywall.terms-1", pool: "paywall", text: "PAYING DEFENDS A VIGIL. IT NEVER IMPROVES A PROPHECY, AND NEVER TOUCHES YOUR ORACLE SCORE." },
] as const;

// Purchase-button labels. Deliberately OUTSIDE the bank: the no-CTA-verb law
// governs ambient copy; a button IS a CTA. Mini-lint: caps, no emoji/!, ≤32.
export const PAYWALL_CTA_LINES = Object.freeze({
  subscribe: "KEEP THE VIGIL",
  rescue: "RAISE THE SHIELD",
  restore: "RECOVER PURCHASES",
} as const);

// OneSignal dashboard campaign copy — the repo is the source of truth; the
// dashboard is a paste target (spec §5). Standard bank rules apply.
export const PUSH_CAMPAIGN_LINES = Object.freeze({
  plusWelcome: "THE SHIELD IS RAISED. YOUR VIGIL IS PROTECTED.",
} as const);

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
//
// ORDER IS LOAD-BEARING. The first OPENING_RITES are what a player needs
// before their first card; the rest are the rules they meet later, and only
// the standing link shows them. Twelve rules in one wall before card I was
// ~150 words of tracked caps that nobody retains (audit 2026-09-02 §1.2), and
// among them the game never once said what it was for (§1.1).
//
// Rites V-VII are that goal, and they take three lines because the first
// attempt took one and still did not land: it said "THE LEDGER RATES EVERY
// CALL" while never defining a CALL, so "0 OF 50 CALLS" stayed a progress bar
// toward an unnamed thing. V defines the noun, VI names what the number buys,
// VII says which calls count and reassures the player that a partial day is
// not a wasted one.
//
// VI states the RATE, and that is the whole point of it. Fifty is a lifetime
// count sitting in a game whose every surface says five — five questions, five
// numerals, seal all five — so read cold it looks like the same scale, and the
// honest question is "fifty of what, there are only five?". "FIVE A DAY, SO
// TEN DAYS AT THE LEAST" converts it on the spot. At the least, not exactly:
// a voided question earns no brier, so a day can rate fewer than five and the
// tenth day is a floor, never a promise.
export const RITES_LINES = [
  // ── the opening: everything the first card depends on ──
  "FIVE QUESTIONS. ONCE A DAY. NOON TO NOON, NEW YORK TIME.",
  "PULL TOWARD YES OR NO. THE LONGER THE PULL, THE GREATER THE CONVICTION. TO RELEASE IS TO SEAL.",
  "AN ANSWER SEALED CANNOT BE UNSEALED. THE CROWD IS HIDDEN UNTIL YOU COMMIT.",
  "CONVICTION PAYS WHEN RIGHT. IT COSTS MORE WHEN WRONG.",
  "EVERY ANSWER YOU SEAL IS A CALL. THE LEDGER RATES IT AGAINST WHAT HAPPENED.",
  "FIFTY RATED CALLS WRITE YOUR ORACLE SCORE. FIVE A DAY, SO TEN DAYS AT THE LEAST.",
  "A DAY'S CALLS RATE ONLY IF ALL FIVE WERE SEALED. POINTS AND VIGIL COUNT EITHER WAY.",
  "A VIGIL IS A RUN OF UNBROKEN NOONS. IT WEIGHS EVERY DAY YOU KEEP IT, IN BOTH DIRECTIONS.",
  "MISS A NOON AND A SHIELD MAY HOLD A VIGIL OF THREE DAYS OR MORE. ONE IS GRANTED EACH MONTH.",
  // ── the rest: met in play, kept on the standing link ──
  "THE VIGIL'S WEIGHT RISES FOR TEN DAYS AND THEN HOLDS. NOTHING BOUGHT CHANGES YOUR ORACLE SCORE.",
  "A QUESTION CLOSES THE MOMENT ITS ANSWER BEGINS TO EXIST. SOME CLOSE BEFORE NOON.",
  "EVERY QUESTION IS PUT TO THE MACHINE BEFORE IT IS PUT TO YOU. WHAT IT COULD ANSWER, YOU NEVER SEE.",
  "THE BIG ONE COUNTS DOUBLE. IN BOTH DIRECTIONS.",
  "STAND AGAINST THE TIDE AND PREVAIL: THE LEDGER ADDS A BOUNTY. TWENTY MUST HAVE SPOKEN.",
  "SEAL ALL FIVE WITHIN THE FIRST HOUR. THE DAY WEIGHS TEN PERCENT MORE, IN BOTH DIRECTIONS.",
  "THE LEDGER IS READ AT NOON. NOTHING IS REVISED.",
] as const;

// How many of the rites a first-timer is shown before their first card. The
// two screens share one numbered canon, so the opening's numerals (I..VI) are
// the same numerals those rules carry in the full list.
export const OPENING_RITES = 9;
export const OPENING_RITES_LINES = RITES_LINES.slice(0, OPENING_RITES);

// The plaque's gloss under the Oracle Score. The score is the whole premise —
// the ledger naming who can actually see — and until now no screen in the app
// said what it was, what "rates" meant, or what fifty was fifty OF (audit
// 2026-09-02 §1.1). Two states: how it is earned, then what it is.
export const SCORE_GLOSS = Object.freeze({
  unwritten: "FIVE CALLS A DAY, FIFTY TO WRITE IT. A DAY RATES ONLY IF ALL FIVE WERE SEALED.",
  written: "YOUR CALIBRATION, READ AGAINST WHAT HAPPENED. NOTHING PURCHASABLE TOUCHES IT.",
} as const);

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

// The pipeline's own two lines (design 2026-09-04 §11.2, §11.3). Both describe
// something the machine DID, in the moment it did it — an early lock it pulled
// forward because the answer appeared, and a question two independent readers
// could not agree on. Kept here, in the bank's file, so the copy lint governs
// them; adding either at its call site would be adding it to dodge the lint.
export const PIPELINE_LINES = Object.freeze({
  lockHealed: "THE ANSWER EXISTS. THIS ONE IS CLOSED.",
  voidDisagreement: "THE READERS DID NOT AGREE. THIS ONE IS STRUCK.",
} as const);

// What the gauntlet cost, in candidates. Null below one written candidate, so
// a bank drop — and every round authored before migration 0007 — stays silent
// rather than claiming a gauntlet that never ran.
export function provenanceLine(written: number, rejected: number): string | null {
  if (written <= 0) return null;
  return `${written} WRITTEN · ${rejected} PUT DOWN`;
}

// Introduction is intentionally separate from the reference rulebook.
export const INTRO_LINES = [
  "FIVE QUESTIONS ABOUT TOMORROW.",
  "CHOOSE YOUR ANSWER AND HOW SURE YOU ARE.",
  "RETURN TO SEE WHETHER YOU BEAT THE ORACLE.",
] as const;

// Archived rounds retain their original canon. New rounds use recognition-only attendance.
export const RITES_V2_LINES = RITES_LINES.map(line => {
  if (line.startsWith("A DAY'S CALLS RATE")) return "EVERY NON-VOID QUESTION MUST BE SEALED. AT LEAST THREE MUST BE READ FOR A DAY TO RATE.";
  if (line.startsWith("A VIGIL IS")) return "A VIGIL IS A RUN OF UNBROKEN NOONS. IT RECORDS YOUR RETURN, NEVER MULTIPLIES YOUR POINTS.";
  if (line.startsWith("THE VIGIL'S WEIGHT")) return "A SHIELD PRESERVES CONTINUITY. NOTHING BOUGHT CHANGES YOUR POINTS OR ORACLE SCORE.";
  if (line.includes("WITHIN THE FIRST HOUR")) return "ALL FIVE WITHIN THE FIRST HOUR EARN AN EARLY MARK. THE POINTS DO NOT CHANGE.";
  if (line.startsWith("A QUESTION CLOSES")) return "IF AN ANSWER APPEARS BEFORE NOON, THE QUESTION CLOSES AND IS VOID FOR EVERYONE.";
  if (line.startsWith("THE LEDGER IS READ AT NOON")) return "THE LEDGER IS READ AFTER THE QUESTIONS CLOSE. UNREAD QUESTIONS ARE NEVER LOSSES.";
  if (line.startsWith("STAND AGAINST THE TIDE")) return "A TIDE BOUNTY IS SEPARATE FROM THE DUEL AND BOARD. TWENTY MUST HAVE SPOKEN.";
  return line;
});
