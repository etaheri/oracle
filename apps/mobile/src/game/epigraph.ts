// The daily epigraph: a museum placard under the wordmark, rotated by date so
// each visit to the temple reads one fresh line. Canon is public-domain
// oracular writ (Delphi, Heraclitus, the Romans, Shakespeare); the old Yogi
// Berra house quote survives as a rare easter-egg draw — a 1-in-29 wink lands
// better than a permanent one.

export interface Epigraph {
  text: string;
  source: string;
}

export const EPIGRAPHS: ReadonlyArray<Epigraph> = [
  { text: "Know thyself.", source: "Inscribed at Delphi" },
  { text: "Nothing in excess.", source: "Inscribed at Delphi" },
  {
    text: "The lord whose oracle is at Delphi neither speaks nor conceals, but gives a sign.",
    source: "Heraclitus",
  },
  { text: "Character is destiny.", source: "Heraclitus" },
  { text: "Nothing endures but change.", source: "Heraclitus" },
  { text: "Fate leads the willing, and drags along the reluctant.", source: "Seneca" },
  { text: "Fortune favors the bold.", source: "Virgil" },
  { text: "The die is cast.", source: "Julius Caesar" },
  { text: "Man is the measure of all things.", source: "Protagoras" },
  { text: "Whatever happens at all happens as it should.", source: "Marcus Aurelius" },
  { text: "What's past is prologue.", source: "The Tempest" },
  {
    text: "If you can look into the seeds of time, and say which grain will grow and which will not, speak then to me.",
    source: "Macbeth",
  },
];

export const EASTER_EGG: Epigraph = {
  text: "It's tough to make predictions, especially about the future.",
  source: "Yogi Berra",
};

// Char-sum seed: consecutive dates land on different entries (the day digit
// walks the canon in order), and the same date always draws the same line —
// the oracle does not change its mind.
function seed(date: string): number {
  let h = 0;
  for (const c of date) h = h * 31 + c.charCodeAt(0);
  return Math.abs(h);
}

export function epigraphFor(date: string): Epigraph {
  const h = seed(date);
  if (h % 29 === 0) return EASTER_EGG;
  return EPIGRAPHS[h % EPIGRAPHS.length]!;
}
