import { describe, it, expect } from "vitest";
import { jsxTextLiterals } from "./jsxText";

// The extractor the vocabulary lint reads a JSX tree through. Its two jobs
// pull against each other: see every run of player prose, and see no
// TypeScript at all.

describe("jsxTextLiterals", () => {
  it("reads a plain text child", () => {
    expect(jsxTextLiterals("<Text>Hello world</Text>")).toEqual(["Hello world"]);
  });

  it("reads the run before a nested tag, which the old `>...</` match dropped", () => {
    expect(jsxTextLiterals("<Text>Hello confidence <Bold>world</Bold></Text>")).toContain("Hello confidence");
  });

  it("reads the run before an interpolation, which the old match missed entirely", () => {
    expect(jsxTextLiterals("<Text>Hello confidence {name}</Text>")).toEqual(["Hello confidence"]);
  });

  it("reads the run after an interpolation closes", () => {
    expect(jsxTextLiterals("<Text>{n} calls in a row</Text>")).toEqual(["calls in a row"]);
  });

  it("reads past an attribute holding an arrow function", () => {
    expect(jsxTextLiterals("<Pressable onPress={() => go()}>Take a side</Pressable>")).toEqual(["Take a side"]);
  });

  it("reads an element passed as an attribute, where a screen's footers live", () => {
    const src = '<Screen footer={<Mono style={{ gap: 2 }}>no record bears this name</Mono>}><Text>the day is open</Text></Screen>';
    expect(jsxTextLiterals(src).sort()).toEqual(["no record bears this name", "the day is open"]);
  });

  it("reads a fragment's children", () => {
    expect(jsxTextLiterals("<>The line is posted<Rule /></>")).toEqual(["The line is posted"]);
  });

  it("reads text nested two elements deep, and both halves around a child", () => {
    const src = "<View><Text>the upper third <Mono>of 312</Mono> sealed records</Text></View>";
    expect(jsxTextLiterals(src)).toEqual(["the upper third", "of 312", "sealed records"]);
  });

  it("never reads a generic as prose", () => {
    expect(jsxTextLiterals("const xs: Array<string> = fromServer<Round, Error>(raw);")).toEqual([]);
  });

  it("never reads a comparison as prose", () => {
    expect(jsxTextLiterals("const ok = a > b && c < d;")).toEqual([]);
  });

  it("stops at the end of an element instead of swallowing the code after it", () => {
    const src = 'const a = <Text>hi there</Text>;\nconst s = pick("not jsx at all");\n';
    expect(jsxTextLiterals(src)).toEqual(["hi there"]);
  });

  it("keeps a string literal's angle brackets out of the scan", () => {
    expect(jsxTextLiterals('const s = "a < b and c > d";')).toEqual([]);
  });

  it("ignores a single word, which is an identifier far more often than prose", () => {
    expect(jsxTextLiterals("<Text>{value}</Text><Text>SEALED</Text>")).toEqual([]);
  });
});
