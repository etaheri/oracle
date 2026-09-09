import { CONSTANTS } from "./constants";
import { CURRENT_GAME_COPY } from "./gameCopy";

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
  "YOUR CALLS, THE ORACLE, AND THE DAILY BOARD.",
] as const;
export const LITURGY = LITURGY_LINES.join(" ");

export function fillSlots(text: string, slots: { n?: number; streak?: number }): string {
  return text
    .replace(/\{n\}/g, slots.n === undefined ? "{n}" : String(slots.n))
    .replace(/\{streak\}/g, slots.streak === undefined ? "{streak}" : String(slots.streak));
}

export const COPY_BANK: ReadonlyArray<CopyLine> = [
  // ── noon: the hinge. Ledger read; the pull, never the payoff. ──
  { id: "noon.generic-1", pool: "noon", text: "MAKE YOUR CALL. LET THE OUTCOME ANSWER." },
  { id: "noon.generic-2", pool: "noon", text: "WHAT DO YOU SEE COMING?" },
  { id: "noon.generic-3", pool: "noon", text: "A HUNCH IS A START. HOW SURE ARE YOU?" },
  { id: "noon.generic-4", pool: "noon", text: "THE ANSWER MATTERS. SO DOES HOW SURE YOU ARE." },
  { id: "noon.generic-5", pool: "noon", text: "OUTSEE THE ORACLE. OUTSCORE THE FIELD." },
  { id: "noon.read-1", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results", "wrong"] },
  { id: "noon.read-2", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.read-3", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.read-4", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.read-5", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.read-6", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.read-7", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.read-8", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.read-9", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results", "wrong"] },
  { id: "noon.read-10", pool: "noon", text: "YOUR RESULT IS READY. HOW DID YOUR CONFIDENCE HOLD UP?", requires: ["results"] },
  { id: "noon.tide-1", pool: "noon", text: "YOU STOOD AGAINST THE TIDE. THE TIDE BROKE.", requires: ["tideWin"] },
  { id: "noon.tide-2", pool: "noon", text: "THE CROWD WENT ONE WAY. YOU WENT THE OTHER. THE LEDGER BOWED TO YOU.", requires: ["tideWin"] },
  { id: "noon.tide-3", pool: "noon", text: "FEW STOOD WHERE YOU STOOD. THE LEDGER PAID A BOUNTY.", requires: ["tideWin"] },
  { id: "noon.lapsed-1", pool: "noon", text: "YOUR RECORD IS STILL HERE. THE NEXT CALL IS YOURS.", requires: ["lapsed"] },
  { id: "noon.lapsed-2", pool: "noon", text: "YOUR RECORD IS STILL HERE. THE NEXT CALL IS YOURS.", requires: ["lapsed"] },
  { id: "noon.lapsed-3", pool: "noon", text: "YOUR RECORD IS STILL HERE. THE NEXT CALL IS YOURS.", requires: ["lapsed"] },
  { id: "noon.vigil-1", pool: "noon", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["results", "streak"] },
  { id: "noon.vigil-2", pool: "noon", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["results", "streak"] },
  { id: "noon.vigil-3", pool: "noon", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["results", "streak"] },
  { id: "noon.vigil-4", pool: "noon", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["results", "streak"] },
  // ── closing: the call. Unsealed players only, hours before lock. ──
  { id: "closing.call-1", pool: "closing", text: "WHAT DO YOU SEE COMING?" },
  { id: "closing.call-2", pool: "closing", text: "A HUNCH IS A START. HOW SURE ARE YOU?" },
  { id: "closing.call-3", pool: "closing", text: "THE ANSWER MATTERS. SO DOES HOW SURE YOU ARE." },
  { id: "closing.call-4", pool: "closing", text: "{n} PLAYERS HAVE MADE A CALL.", requires: ["players"] },
  { id: "closing.call-5", pool: "closing", text: "MAKE YOUR CALL. LET THE OUTCOME ANSWER." },
  { id: "closing.call-6", pool: "closing", text: "WHAT DO YOU SEE COMING?" },
  { id: "closing.call-7", pool: "closing", text: "A HUNCH IS A START. HOW SURE ARE YOU?" },
  { id: "closing.call-8", pool: "closing", text: "THE ANSWER MATTERS. SO DOES HOW SURE YOU ARE." },
  { id: "closing.call-9", pool: "closing", text: "OUTSEE THE ORACLE. OUTSCORE THE FIELD." },
  { id: "closing.call-10", pool: "closing", text: "MAKE YOUR CALL. LET THE OUTCOME ANSWER." },
  { id: "closing.call-11", pool: "closing", text: "WHAT DO YOU SEE COMING?" },
  { id: "closing.call-12", pool: "closing", text: "A HUNCH IS A START. HOW SURE ARE YOU?" },
  { id: "closing.call-13", pool: "closing", text: "THE ANSWER MATTERS. SO DOES HOW SURE YOU ARE." },
  { id: "closing.call-14", pool: "closing", text: "OUTSEE THE ORACLE. OUTSCORE THE FIELD." },
  { id: "closing.call-15", pool: "closing", text: "MAKE YOUR CALL. LET THE OUTCOME ANSWER." },
  { id: "closing.call-16", pool: "closing", text: "WHAT DO YOU SEE COMING?" },
  { id: "closing.call-17", pool: "closing", text: "A HUNCH IS A START. HOW SURE ARE YOU?" },
  { id: "closing.call-18", pool: "closing", text: "THE ANSWER MATTERS. SO DOES HOW SURE YOU ARE." },
  { id: "closing.call-19", pool: "closing", text: "OUTSEE THE ORACLE. OUTSCORE THE FIELD." },
  { id: "closing.call-20", pool: "closing", text: "MAKE YOUR CALL. LET THE OUTCOME ANSWER." },
  { id: "closing.partial-1", pool: "closing", text: "A COMPETITIVE RESULT REQUIRES EVERY NON-VOID QUESTION.", requires: ["partial"] },
  { id: "closing.partial-2", pool: "closing", text: "YOUR SEALED CALLS CAN RECEIVE OUTCOMES EVEN IN AN INCOMPLETE ROUND.", requires: ["partial"] },
  // ── streak: vigil lines for in-app surfaces. ──
  { id: "streak.vigil-1", pool: "streak", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["streak"] },
  { id: "streak.vigil-2", pool: "streak", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["streak"] },
  { id: "streak.vigil-3", pool: "streak", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["streak"] },
  { id: "streak.vigil-4", pool: "streak", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["streak"] },
  { id: "streak.vigil-5", pool: "streak", text: "YOUR VIGIL: {streak} DAYS. ONE CALL AT A TIME.", requires: ["streak"] },
  { id: "streak.lapse-1", pool: "streak", text: CURRENT_GAME_COPY.lapse.toUpperCase() },
  { id: "streak.lapse-2", pool: "streak", text: "A GAP IN THE LEDGER IS NOT THE END OF IT." },
  { id: "streak.lapse-3", pool: "streak", text: "STREAKS END. RECORDS REMAIN." },
  { id: "streak.shield-1", pool: "streak", text: CURRENT_GAME_COPY.shieldUsed.toUpperCase() },
  { id: "streak.begin-1", pool: "streak", text: "BEGIN AGAIN. THE ORB DOES NOT DWELL." },
  { id: "streak.risk-1", pool: "streak", text: "YOUR STREAK: {streak} DAYS. ONE SEALED CALL KEEPS IT GOING WHEN THE ROUND SETTLES.", requires: ["streak"] },
  // ── system: states of the machine. ──
  { id: "system.sleep-1", pool: "system", text: "THE ORACLE SLEEPS. NO ROUND IS OPEN." },
  { id: "system.reading-1", pool: "system", text: "OUTCOMES ARE BEING VERIFIED. YOUR CALLS ARE SEALED." },
  { id: "system.offline-1", pool: "system", text: "COULD NOT CONNECT. YOUR SEALED CALLS ARE KEPT." },
  { id: "system.creed-1", pool: "system", text: "A CALL COMES FIRST. THE OUTCOME HAS THE LAST WORD." },
  { id: "system.creed-2", pool: "system", text: "EVERY ANSWER SEALED BEFORE THE OUTCOME." },
  // ── paywall: the shield offer. Protection, never pressure. No CTA verbs here —
  // button labels live in PAYWALL_CTA_LINES by construction. ──
  { id: "paywall.rescue-1", pool: "paywall", text: "A SHIELD MAY PROTECT AN ELIGIBLE STREAK THROUGH A MISSED ROUND.", requires: ["streak"] },
  { id: "paywall.terms-1", pool: "paywall", text: "EVERY ROUND IS FREE TO PLAY. YOUR CALLS EARN YOUR RANK AND FORECAST RATING." },
] as const;

// Purchase-button labels. Deliberately OUTSIDE the bank: the no-CTA-verb law
// governs ambient copy; a button IS a CTA. Mini-lint: caps, no emoji/!, ≤32.
// The reminder door. The summons is the ONE ask a player gets, and it only
// fires after a seal — so a reader who answers nothing is never asked at all,
// and is precisely the reader a reminder is for. These two labels are that
// door: the first opens the summons, the second leaves for Settings, which is
// the only switch left once iOS has been refused.
export const REMINDER_CTA_LINES = Object.freeze({
  ask: "TELL ME BEFORE IT CLOSES",
  settings: "TURN ON REMINDERS IN SETTINGS",
} as const);

export const PAYWALL_CTA_LINES = Object.freeze({
  subscribe: "JOIN OUTSEEN PLUS",
  rescue: "RAISE THE SHIELD",
  restore: "RESTORE PURCHASES",
} as const);

// OneSignal dashboard campaign copy — the repo is the source of truth; the
// dashboard is a paste target (spec §5). Standard bank rules apply.
export const PUSH_CAMPAIGN_LINES = Object.freeze({
  plusWelcome: "OUTSEEN PLUS IS ACTIVE. SHIELD PROTECTION DEPENDS ON YOUR STREAK AND AVAILABLE RESERVE.",
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
// The rating's gloss, in the register a gloss is written in.
//
// These are sentences explaining the stat above them, which is the definition
// of reading copy — and the plaque already sets the vigil's gloss in sentence
// case eight rows below. Holding these two to tracked caps put the same job
// in two opposite voices on one surface. Governed by
// test/reading-register.test.ts rather than by the machine-voice lint.
//
// `unwritten` was also being bypassed entirely: the ledger printed a 130-
// character literal at the call site, which is how it came to state the fifty
// without ever scaling it against the five a day.
// What Plus actually grants, in the register an argument is written in.
//
// These four lines are the case for spending money, and they lived in the
// ambient COPY_BANK — which holds every line to tracked caps, correctly,
// because the bank exists for lines the machine says in passing. Rendered
// through role.supporting on the paywall they became four caps paragraphs in
// the reading register: no tracking to be recognised by, no sentence case to
// be read by. They are read, so they are written to be. Governed by
// test/reading-register.test.ts; the pool's remaining lines (the rescue
// offer, the terms line) stay in the bank because they stay machine voice.
export const PLUS_CREED_LINES = [
  "A shield protects a streak of three days or more through one missed round.",
  "One free shield each month. Plus adds three shields per billing period, capped at five paid shields per grant.",
  "Shields protect your streak, not your score. No calls or wins are added.",
  "Protection requires an eligible streak and an available shield.",
] as const;

export const SCORE_GLOSS = Object.freeze({
  unwritten: "Fifty qualifying calls write your rating — five calls a day, at your own pace. A round qualifies when you complete every non-void question and at least three resolve.",
  written: "How well your confidence matches what happens, across your latest qualifying calls.",
} as const);

// The Calling: the one-time cinematic on the app's very first open — the
// machine recounts the search and assigns the player their role. Lore only;
// every rule belongs to the rites. Hand-written, linted, versioned.
export const CALLING_LINES = ["OUTSEEN", "MEET THE ORACLE", "IT MAKES A CALL. SO DO YOU."] as const;

// The partial-day notice (home, when some but not all five are sealed).
export const PARTIAL_LINE = "A COMPETITIVE RESULT REQUIRES EVERY NON-VOID QUESTION. YOUR CALLS CAN STILL RECEIVE RESULTS.";

// The summons: the interstitial before the OS notification prompt (voice
// spec §4). Three declaratives, then the machine asks once.
export const SUMMONS_LINES = [
  "OUTSEEN CAN SEND UP TO TWO REMINDERS A DAY.",
  "AN INVITATION TO PLAY OR RETURN TO YOUR LEDGER.",
  "NOTIFICATIONS ARE OPTIONAL.",
] as const;

// The pipeline's own two lines (design 2026-09-04 §11.2, §11.3). Both describe
// something the machine DID, in the moment it did it — an early lock it pulled
// forward because the answer appeared, and a question two independent readers
// could not agree on. Kept here, in the bank's file, so the copy lint governs
// them; adding either at its call site would be adding it to dodge the lint.
export const PIPELINE_LINES = Object.freeze({
  lockHealed: "THE ANSWER EXISTS. THIS ONE IS CLOSED.",
  voidDisagreement: "THE READERS DID NOT AGREE. THIS ONE IS STRUCK.",
  // The leak line: an early lock that got healed too late to save the
  // question, forced to void instead (probe.ts, resolution.ts's healed-lock
  // path). Kept here, not as a literal at either call site, so both stay in
  // step and the copy lint governs it.
  answerLeaked: "THE ANSWER LEAKED. VOID FOR EVERYONE.",
  // Editorial withdrawal (design 2026-09-09 §1.4): the operator struck a
  // question that should never have run. Distinct from the leak line above,
  // because "we mis-wrote it" and "the answer leaked" are different facts and
  // the reveal prints whichever one is true.
  //
  // All four of these render into the round screen's single-row banner
  // (round.tsx), a min-height slot sized for one short line — see the ≤40
  // character rule in test/copy-lint.test.ts.
  withdrawnMisauthored: "WITHDRAWN. IT COUNTS FOR NO ONE.",
  withdrawnUnresolvable: "CANNOT SETTLE IN TIME. VOID FOR EVERYONE",
  // The v2 fallback when a struck question carries no server-stated reason.
  struck: "STRUCK · VOID FOR EVERYONE",
} as const);

// What the gauntlet cost, in candidates. Null below one written candidate, so
// a bank drop — and every round authored before migration 0007 — stays silent
// rather than claiming a gauntlet that never ran.
export function provenanceLine(written: number, rejected: number): string | null {
  if (written <= 0) return null;
  return `${written} WRITTEN · ${rejected} PUT DOWN`;
}

// Introduction is intentionally separate from the reference rulebook.
// The opening rites: the only rules screen a first-time player is guaranteed
// to see, and therefore the one that has to be READ rather than recognised.
// It was set in tracked caps while the reference canon below it was converted
// to sentence case — the register work applied to the screen players skip and
// not to the screen they cannot. See test/reading-register.test.ts.
//
// The second rite also carries the gesture now. It used to ask "how sure are
// you?" and never answer how confidence is set, so a first-time player met
// the swipe with nothing but the one-time nudge animation to explain it; the
// sentence that does explain it lived only in the reference rites.
export const INTRO_LINES = [
  "Choose yes or no. Call what happens next.",
  "Pull the card toward your answer, then release to seal it. The further you pull, the more confident the call — and the more it gains or costs.",
  "Return to face the Oracle and find your place among other players.",
] as const;

// RITES_LINES and OPENING_RITES_LINES above are the archived version-1 canon.
// Current rules are explicit data, never substitutions on historical prose.
//
// Each rite is a list of CLAIMS, not a paragraph. The wording is unchanged
// from the paragraph form — these are the sentence boundaries that were
// already in it. Prose fused six short, scannable statements into a wall the
// eye cannot enter; splitting on the boundaries the copy already had restores
// the scan without costing a word of the clarity the rewrite bought. `text`
// rejoins them, so anything reading the canon as one string (the copy lint,
// RITES_V2_LINES, the push bank) sees exactly what it saw before.
//
// `defines` names the terms this rite is the definition of. The screen sets a
// term in tracked caps on its FIRST appearance — in the rite that defines it —
// and plainly everywhere after, so jargon announces itself as jargon once and
// then gets out of the way. Terms are matched against the claims at render
// time rather than baked into the strings, which is what keeps the copy tests
// asserting on ordinary prose.
function rite(title: string, defines: readonly string[], claims: readonly string[]) {
  return { title, defines, claims, text: claims.join(" ") };
}

export const RITES_V2_SECTIONS = [
  // Terms are named without their article: `Term` uppercases the match, so
  // "the crowd" and "daily board" started the emphasis in a different place
  // each time and the rite disagreed with itself one line apart. The claims
  // are plain sentences for the same reason — encoding the caps in the source
  // AND in `defines` says the same thing twice, and the two drift.
  rite("The challenge", ["daily board", "crowd"], [
    "Five questions about what happens next.",
    "Make your calls, then find out whether you outscored the Oracle and other players.",
    CURRENT_GAME_COPY.oracleIdentity,
    "The daily board ranks players.",
    "The crowd shows which way they lean.",
  ]),
  rite("Make a call", ["call", "seal"], [
    "Your prediction is a call.",
    "Choose yes or no and set confidence from 55% to 95%.",
    "Pull toward your answer; a longer pull means greater confidence.",
    "Release to seal.",
    "Sealing locks your answer and confidence.",
    "The crowd is hidden until you commit; the Oracle forecast stays hidden until reveal.",
  ]),
  rite("Face the result", ["big one", "crowd bounty"], [
    "Choose the confidence you can stand behind.",
    "Higher confidence earns more when right and loses more when wrong.",
    "The Big One counts double in both directions.",
    "Your duel and daily board use the same scoring formula for your calls and the Oracle's.",
    "These base points include the Big One, but no crowd bonus.",
    `A correct call on a side below ${CONSTANTS.CONTRARIAN_CROWD_PCT}% earns a separate crowd bounty when at least ${CONSTANTS.CONTRARIAN_MIN_CROWD} players answered.`,
    "The bounty does not affect duel or board.",
  ]),
  rite("Build your record", ["forecast rating", "competitive round"], [
    "A single round settles a challenge.",
    "Your record shows how your judgment holds up over time.",
    `Your forecast rating measures performance over qualifying calls and appears after ${CONSTANTS.ORACLE_SCORE_MIN_CALLS} cumulative qualifying calls, not consecutive days.`,
    "A competitive round requires every non-void question sealed and at least three resolved, non-void questions.",
    "Only calls from eligible rounds count toward that rating.",
    `Daily board placing does not require 50 calls; a placing needs at least ${CONSTANTS.BOARD_MIN_FIELD} eligible players; the Oracle is also shown for comparison.`,
    "Confidence history also includes resolved calls from incomplete rounds, showing how your confidence matched outcomes.",
  ]),
  rite("Keep a vigil", ["vigil", "shield", "exhibitions"], [
    "Your vigil is your playing streak.",
    "Seal at least one call in a daily round to keep it going; the count updates when that round settles.",
    CURRENT_GAME_COPY.streakMeaning,
    `A shield can preserve a streak of ${CONSTANTS.SHIELD_MIN_STREAK} days or more through a missed round, without incrementing it or adding calls.`,
    "One free shield is available each calendar month; available paid shields are used after it.",
    CURRENT_GAME_COPY.lapse,
    "Exhibitions do not count.",
    "Streaks and early marks do not multiply current points.",
  ]),
  rite("Timing and fairness", ["void", "abstention"], [
    "Each question has its own deadline.",
    "If an answer appears early, the question closes and is void for everyone.",
    "Results follow verification, not a guaranteed time.",
    "Unresolved outcomes are pending, never losses; void questions score nothing.",
    "Incomplete rounds still keep the results of your calls.",
    "An outcome correction or void can update your record.",
    "The Oracle can report any chance of YES from 0% to 100%; 50% is an abstention.",
    "Players choose a side at 55% to 95% confidence.",
    "Both use the same points formula.",
    "Older rounds retain their versioned rules.",
  ]),
];
export const RITES_V2_LINES = RITES_V2_SECTIONS.map(section => `${section.title.toUpperCase()}: ${section.text}`);

// One claim, split into the run that is a defined term and the runs that are
// not. The screen sets `term` segments in the machine's tracked caps and the
// rest in ordinary reading text: the jargon announces itself exactly once,
// where it is defined, and reads as a plain word every time after.
export type ClaimSegment = { text: string; term: boolean };

const WORD = /[A-Za-z0-9]/;
const boundedAt = (haystack: string, needle: string, from: number): number => {
  for (let i = haystack.toLowerCase().indexOf(needle, from); i !== -1; i = haystack.toLowerCase().indexOf(needle, i + 1)) {
    const before = i === 0 || !WORD.test(haystack[i - 1]!);
    const after = i + needle.length >= haystack.length || !WORD.test(haystack[i + needle.length]!);
    if (before && after) return i;
  }
  return -1;
};

// First use only, and first use is scoped to the rite that DEFINES the term —
// which is why this walks a whole section rather than a line. "The crowd is
// hidden until you commit" in `Make a call` is prose; THE CROWD in
// `The challenge` is a definition, and only the definition is set as one.
export function emphasizeClaims(claims: readonly string[], defines: readonly string[]): ClaimSegment[][] {
  const pending = defines.map(t => t.toLowerCase());
  return claims.map(claim => {
    const out: ClaimSegment[] = [];
    let rest = claim;
    for (;;) {
      let best = -1;
      let bestTerm = "";
      for (const term of pending) {
        const at = boundedAt(rest, term, 0);
        if (at !== -1 && (best === -1 || at < best)) { best = at; bestTerm = term; }
      }
      if (best === -1) break;
      pending.splice(pending.indexOf(bestTerm), 1);
      if (best > 0) out.push({ text: rest.slice(0, best), term: false });
      out.push({ text: rest.slice(best, best + bestTerm.length), term: true });
      rest = rest.slice(best + bestTerm.length);
    }
    if (rest) out.push({ text: rest, term: false });
    return out;
  });
}
