import { View } from "react-native";
import { emphasizeClaims } from "@oracle/core";
import { Mono, Term, role } from "./Text";
import { colors, space } from "../theme";

// A rite's claims, one per row.
//
// This is the human half of the two registers. Everything the machine says
// about ITSELF -- the numeral, the stamp, the eyebrow, the button -- is
// tracked caps, because it is recognised at a glance. Everything it explains
// TO you is set here: sentence case, near-zero tracking, its own line box.
// Caps cost about a tenth of your reading speed because they flatten the
// word shapes you actually recognise, which is a price worth paying on a
// three-word label and never worth paying on a paragraph.
//
// The claims are not a paragraph. They are the sentences the copy already
// had, given their own rows -- so the eye can find "Release to seal" without
// reading the five statements around it. Row gap rather than a hard line
// break, so a claim that wraps at a large text size still reads as one claim.
export function ClaimList({ claims, defines, color = colors.ink }: {
  claims: readonly string[];
  defines: readonly string[];
  color?: string;
}) {
  const rows = emphasizeClaims(claims, defines);
  return (
    <View style={{ gap: space(2) }}>
      {rows.map((segments, i) => (
        <Mono key={claims[i]} {...role.reading} color={color} maxFontSizeMultiplier={0}>
          {segments.map((segment, j) => segment.term
            ? <Term key={j}>{segment.text}</Term>
            : segment.text)}
        </Mono>
      ))}
    </View>
  );
}
