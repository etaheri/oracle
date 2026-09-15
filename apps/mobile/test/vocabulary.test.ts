import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The vocabulary cut (design §8.1, D12), enforced on the app's own inline
// literals -- the core lint covers @oracle/core, but roughly eighty player
// strings live in JSX here and drift back one at a time if nothing watches.
//
// A string literal is prose when it contains a space; identifiers, route
// paths, storage keys, event names and API fields never do. Comments are
// stripped first so the reasoning in them can still name the old words.
const RETIRED = /\b(vigils?|shields?|exhibitions?|rites?|ledgers?|crowds?|conviction|epithets?|oracle rating|confidence|calibration|rungs?|ladder)\b/i;
const ROOT = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function proseLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    if (text.includes(" ")) out.push(text);
  }
  return out;
}

describe("the vocabulary cut in the app", () => {
  it("scans the tree", () => {
    expect(walk(ROOT).length).toBeGreaterThan(50);
  });

  it("never prints a retired word to a player", () => {
    const offences: string[] = [];
    for (const file of walk(ROOT)) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const text of proseLiterals(src)) {
        if (RETIRED.test(text)) offences.push(`${file.slice(ROOT.length + 1)}: "${text}"`);
      }
    }
    expect(offences).toEqual([]);
  });
});
