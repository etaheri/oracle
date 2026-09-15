// The prose a player reads out of a JSX tree, for the vocabulary lint.
//
// A JSX text child is any run between a tag's `>` and the next `<` or `{`, and
// between an expression's `}` and the next `<` or `{`. The narrow
// `/>([^<>{}]*)<\//` this replaces matched only the first shape, and only when
// nothing at all sat between the two tags -- so `<Text>Hello <Bold>world</Bold>`
// handed the lint "world" and hid "Hello", and `<Text>Hello {name}</Text>`
// handed it nothing at all. Most player prose in this app has a nested tag or
// an interpolation in it, which is exactly the prose that went unscanned.
//
// Widening the match is the dangerous part, because `<` and `>` are also
// generics and comparisons: a plain split on them names about thirty passages
// of TypeScript as player copy. This scanner never widens. It enters text mode
// only after a `<` it has decided opens a JSX element, and it leaves text mode
// when that element closes -- so `Array<string>` and `a > b && c < d` open
// nothing and nothing after them is ever read as prose.

type Frame = { elemDepth: number; braceDepth: number };

// What a `<` sits against tells a tag from a generic. In `Array<string>` and
// `a < b` it sits against an identifier; in JSX it sits against punctuation
// (`&& <Text>`, `? <Text>`, `( <Text>`) or against one of the few keywords
// that can precede an expression.
const IDENT_BEFORE = /[A-Za-z0-9_$)\]]/;
const KEYWORD_BEFORE = /(?:^|[^A-Za-z0-9_$])(return|yield|await|case|do|else|typeof|void|delete|in|of)$/;

function skipString(src: string, quote: string, from: number): number {
  let i = from + 1;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\") { i += 2; continue; }
    if (c === quote) return i + 1;
    if (quote === "`" && c === "$" && src[i + 1] === "{") { i = skipBraced(src, i + 1); continue; }
    // An unterminated quote is a mis-parse, not a string: stop at the line
    // rather than swallowing the rest of the file.
    if (quote !== "`" && c === "\n") return i;
    i++;
  }
  return src.length;
}

function skipBraced(src: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, c, i); continue; }
    if (c === "{") { depth++; i++; continue; }
    if (c === "}") { depth--; i++; if (depth === 0) return i; continue; }
    i++;
  }
  return src.length;
}

function opensTag(src: string, at: number): boolean {
  const next = src[at + 1];
  if (next === ">") return true; // a fragment, which holds text children too
  const nameAt = next === "/" ? at + 2 : at + 1;
  if (!/[A-Za-z]/.test(src[nameAt] ?? "")) return false;
  let j = at - 1;
  while (j >= 0 && /\s/.test(src[j]!)) j--;
  if (j < 0) return true;
  if (!IDENT_BEFORE.test(src[j]!)) return true;
  return KEYWORD_BEFORE.test(src.slice(0, j + 1));
}

export function jsxTextLiterals(src: string): string[] {
  const out: string[] = [];
  const stack: Frame[] = [];
  let mode: "code" | "tag" | "text" = "code";
  let elemDepth = 0;
  let braceDepth = 0;
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    if (mode === "text") {
      let j = i;
      while (j < src.length && src[j] !== "<" && src[j] !== "{" && src[j] !== "}") j++;
      const run = src.slice(i, j).replace(/\s+/g, " ").trim();
      if (run.includes(" ")) out.push(run);
      i = j;
      if (i >= src.length) break;
      const d = src[i]!;
      if (d === "{") {
        // An expression child is ordinary code until its own elements open, so
        // it starts a fresh element depth. Carrying the parent's over is what
        // makes `{a ? (<View>…</View>) : (<Other/>)}` look like text again the
        // moment the first View closes, and `) : (` is not prose.
        stack.push({ elemDepth, braceDepth });
        elemDepth = 0;
        braceDepth = 0;
        mode = "code";
        i++;
      } else if (d === "}") {
        const frame = stack.pop();
        if (frame) { elemDepth = frame.elemDepth; braceDepth = frame.braceDepth; }
        i++;
      } else if (src[i + 1] === ">" || src[i + 1] === "/" || /[A-Za-z]/.test(src[i + 1] ?? "")) {
        mode = "tag";
      } else {
        i++; // a bare `<` printed as text
      }
      continue;
    }

    if (mode === "tag") {
      const closing = src[i + 1] === "/";
      let j = i + 1;
      let selfClosing = false;
      while (j < src.length) {
        const t = src[j]!;
        if (t === '"' || t === "'" || t === "`") { j = skipString(src, t, j); continue; }
        // An attribute expression can hold anything, `=>` and `>` included --
        // and in this app it routinely holds an element of its own
        // (`header={<TopBar />}`, `footer={…}`), so its prose is read too.
        if (t === "{") {
          const end = skipBraced(src, j);
          out.push(...jsxTextLiterals(src.slice(j + 1, Math.max(j + 1, end - 1))));
          j = end;
          continue;
        }
        if (t === ">") { selfClosing = src[j - 1] === "/"; break; }
        j++;
      }
      if (closing) elemDepth = Math.max(0, elemDepth - 1);
      else if (!selfClosing) elemDepth++;
      i = j + 1;
      mode = elemDepth > 0 ? "text" : "code";
      continue;
    }

    if (c === '"' || c === "'" || c === "`") { i = skipString(src, c, i); continue; }
    if (c === "{") { braceDepth++; i++; continue; }
    if (c === "}") {
      if (braceDepth === 0 && stack.length > 0) {
        const frame = stack.pop()!;
        elemDepth = frame.elemDepth;
        braceDepth = frame.braceDepth;
        mode = "text";
        i++;
        continue;
      }
      braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (c === "<" && opensTag(src, i)) { mode = "tag"; continue; }
    i++;
  }

  return out;
}
