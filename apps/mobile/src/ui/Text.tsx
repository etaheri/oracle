import { Text, useWindowDimensions, type TextProps } from "react-native";
import { colors, fonts, typeScale, ROW_H, trackTail } from "../theme";
import { CHROME_CAP } from "../game/typeScaling";

export function Serif({ size = 18, color = colors.ink, style, ...rest }: TextProps & { size?: number; color?: string }) {
  return <Text {...rest} style={[{ fontFamily: fonts.display, fontSize: size, lineHeight: Math.ceil(size * 1.45), color }, style]} />;
}

// Carved-caps temple voice. Per brief §7 ("card = artifact"), reserved for the
// wordmark, card numerals, and day points only. Scarcity keeps it sacred.
export function Ritual({ size = 14, color = colors.goldText, bold = false, letterSpacing = 3, style, ...rest }: TextProps & { size?: number; color?: string; bold?: boolean; letterSpacing?: number }) {
  // Remount native text when Dynamic Type changes so capped glyphs are remeasured.
  const { fontScale } = useWindowDimensions();
  return <Text key={fontScale} maxFontSizeMultiplier={CHROME_CAP} {...rest} style={[{ fontFamily: bold ? fonts.ritualBold : fonts.ritual, fontSize: size, lineHeight: Math.ceil(size * 1.5), color, letterSpacing }, style]} />;
}

export function Mono({ size = 13, color = colors.mutedInk, letterSpacing = 0.5, style, ...rest }: TextProps & { size?: number; color?: string; letterSpacing?: number }) {
  // Remount native text when Dynamic Type changes so capped glyphs are remeasured.
  const { fontScale } = useWindowDimensions();
  return <Text key={fontScale} maxFontSizeMultiplier={CHROME_CAP} {...rest} style={[{ fontFamily: fonts.mono, fontSize: size, lineHeight: Math.ceil(size * 1.5), color, letterSpacing }, style]} />;
}

// The machine-voice roles as ready-made props, spreadable onto <Mono> or
// <DecodeLine>. Each carries its own line box, so a row of chrome is exactly
// ROW_H tall whatever the font metrics do — which is what lets Home reserve
// space for lines that have not arrived yet. Spread these instead of typing a
// size/letterSpacing/lineHeight triplet at the call site; pass `color` to say
// which voice it is.
export const role = {
  supporting: { ...typeScale.supporting, style: { lineHeight: ROW_H.supporting } },
  caption: { ...typeScale.caption, style: { lineHeight: ROW_H.caption } },
  body: { ...typeScale.body, style: { lineHeight: ROW_H.body } },
  action: { ...typeScale.action, style: { lineHeight: ROW_H.action, textAlign: "center" as const, ...trackTail(typeScale.action.letterSpacing) } },
  eyebrow: { ...typeScale.eyebrow, style: { lineHeight: ROW_H.meta, textAlign: "center" as const, ...trackTail(typeScale.eyebrow.letterSpacing) } },
  meta: { ...typeScale.meta, style: { lineHeight: ROW_H.meta, textAlign: "center" as const, ...trackTail(typeScale.meta.letterSpacing) } },
  line: { ...typeScale.line, style: { lineHeight: ROW_H.line, textAlign: "center" as const, ...trackTail(typeScale.line.letterSpacing) } },
} as const;

export function Eyebrow({ children }: { children: string }) {
  return <Mono {...role.eyebrow} color={colors.goldText} style={[role.eyebrow.style, { textTransform: "uppercase" }]}>{children}</Mono>;
}
