import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The two registers, guarded.
//
// The machine's chrome is TRACKED -- 1 to 5 points of letter spacing, set by
// the role scale in theme.ts -- because it is recognised at a glance. Reading
// text is set near zero, because tracking is what makes continuous text slow.
// A <Mono> that names a size but never says which of those it is has opted out
// of the distinction, and that is exactly how the app lost its voice one prop
// at a time: new copy landed as bare `<Mono size={12}>` and quietly rendered
// at the default 0.5, which is neither register.
//
// This is a ratchet, not a ban. The exceptions below are deliberate
// micro-typography inside instruments, where the glyph size IS the design and
// no role applies. Adding a file to this list should take an argument; the
// fix for anything else is to spread a role.
const ALLOWED = new Map<string, string>([
  // The conviction meter: an 8pt scale cap and a 13pt bar glyph on a 15pt
  // pitch. This is a drawn instrument that happens to be built from type.
  ["src/ui/ConvictionColumn.tsx", "meter glyphs, sized to the bar not the scale"],
  // The card's interior, whose measurements are tuned to the tarot ratio and
  // the question's own 22/32 setting rather than to the chrome scale.
  ["src/ui/OracleCard.tsx", "card interior, tuned to the artifact's own metrics"],
]);

const SRC = join(__dirname, "..", "src");
const TAG = /<Mono\b[^>]*?\bsize=\{[0-9]+\}[^>]*?>/gs;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
  });
}

describe("type register", () => {
  it("declares a register at every sized <Mono>, or is a listed instrument", () => {
    const offenders = new Set<string>();
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const tag of source.match(TAG) ?? []) {
        if (!tag.includes("letterSpacing")) {
          offenders.add(file.slice(file.indexOf("src/")));
        }
      }
    }
    const unexpected = [...offenders].filter((f) => !ALLOWED.has(f)).sort();
    expect(unexpected, "spread a role from ui/Text (role.line, role.reading, role.caption…) instead of a bare size").toEqual([]);
  });

  // The other direction. The test above catches a <Mono> that names no
  // register; this one catches a <Mono> that names the READING register and
  // then shouts through it. `supporting` and `reading` are tracked at 0.5 and
  // 0.2 precisely so continuous text is legible — pour caps into them and the
  // line gets neither: no tracking to be recognised as a token, no sentence
  // case to be read as a sentence. The copy's own half of this rule lives in
  // packages/core/test/reading-register.test.ts.
  it("never shouts through the reading register", () => {
    // <Mono {...role.supporting} …>SOME TEXT</Mono> — literal children only;
    // an interpolated {value} is the row's data, not its voice.
    const READING_TAG = /<(?:Mono|DecodeLine)\b[^>]*?\{\.\.\.role\.(?:supporting|reading)\}[^>]*?>([^<]*)</gs;
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(READING_TAG)) {
        const literal = match[1]!.replace(/\{[^}]*\}/g, "").trim();
        // Two or more consecutive all-caps words is a shout, not an acronym.
        if (/\b[A-Z]{2,}\b[^a-z]*\b[A-Z]{2,}\b/.test(literal)) {
          offenders.push(`${file.slice(file.indexOf("src/"))}: "${literal.slice(0, 48)}"`);
        }
      }
    }
    expect(offenders.sort(), "set this in sentence case, or move it to a machine role (role.line / role.meta / role.caption)").toEqual([]);
  });

  it("keeps the exception list honest: every allowed file still has one", () => {
    const offenders = new Set<string>();
    for (const file of walk(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const tag of source.match(TAG) ?? []) {
        if (!tag.includes("letterSpacing")) offenders.add(file.slice(file.indexOf("src/")));
      }
    }
    const stale = [...ALLOWED.keys()].filter((f) => !offenders.has(f)).sort();
    expect(stale, "these files were cleaned up — drop them from ALLOWED").toEqual([]);
  });
});
