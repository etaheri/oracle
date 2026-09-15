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
//
// JSX text nodes are prose too, and a plain quoted-literal scan misses them
// entirely -- `<Mono>Higher confidence makes...</Mono>` prints straight to a
// player without ever sitting inside a string literal. `jsxTextLiterals`
// catches those below.
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

function jsxTextLiterals(src: string): string[] {
  const out: string[] = [];
  // A JSX text child sits between a tag's `>` and the next tag's `</` with
  // nothing else between them -- no nested tag, no `{expression}`. That
  // narrow shape is what keeps this off TypeScript generics (`Array<T>`),
  // comparisons (`a > b`), and an embedded field access like
  // `{highlight.my?.confidence}`, none of which end in a literal `</`.
  const re = />([^<>{}]*)<\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const text = m[1].replace(/\s+/g, " ").trim();
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
      for (const text of [...proseLiterals(src), ...jsxTextLiterals(src)]) {
        if (RETIRED.test(text)) offences.push(`${file.slice(ROOT.length + 1)}: "${text}"`);
      }
    }
    expect(offences).toEqual([]);
  });
});
