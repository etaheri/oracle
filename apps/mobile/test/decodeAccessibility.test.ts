import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFrame } from "../src/game/terminalPrint";

// The machine's voice, as the screen reader hears it.
//
// DecodeLine renders literal noise characters — a real <Text> node whose
// content is "+*:=%#/\-·" until the print finishes. VoiceOver reads the node,
// not the intent, so without a label every printed line in the app is
// announced as punctuation. The reduced-motion escape hatch does not cover
// this: Reduce Motion and VoiceOver are different iOS settings, and a line
// held at `active={false}` (Home's state row, the clock, the challenge)
// never leaves step 0 at all.
//
// A source scan rather than a render test because this app tests pure
// modules and scans sources; the invariant is one prop on one component and
// it guards thirty call sites.
const DECODE = readFileSync(join(__dirname, "..", "src", "ui", "DecodeText.tsx"), "utf8");

describe("printed lines are legible to a screen reader", () => {
  it("holds unresolved characters that are pure noise", () => {
    // The premise: what a screen reader would otherwise read aloud.
    const frame = decodeFrame("THE ORACLE IS CONSULTED", 0, 8, "seed");
    expect(frame).not.toContain("ORACLE");
    expect(frame.replace(/ /g, "")).toMatch(/^[+*:=%#/\\\-·]+$/);
  });

  it("labels the printed line with its finished text", () => {
    // The label must be the resolved string, not the animating child.
    expect(DECODE, "DecodeLine must pass accessibilityLabel={text} to its Face")
      .toMatch(/accessibilityLabel=\{text\}/);
  });

  it("keeps the blinking cursor out of the accessibility tree", () => {
    // "_" blinking on a loading line becomes "underscore" every 530ms.
    const cursor = DECODE.slice(DECODE.indexOf("cursor &&"));
    expect(cursor, "the cursor <Text> must be accessible={false} or importantForAccessibility no-hide-descendants")
      .toMatch(/accessible=\{false\}|importantForAccessibility/);
  });
});
