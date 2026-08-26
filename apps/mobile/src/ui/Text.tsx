import { Text, type TextProps } from "react-native";
import { colors, fonts } from "../theme";

export function Serif({ size = 18, color = colors.ink, style, ...rest }: TextProps & { size?: number; color?: string }) {
  return <Text {...rest} style={[{ fontFamily: fonts.display, fontSize: size, color }, style]} />;
}

// Carved-caps temple voice. Reserved for ritual moments: the wordmark,
// commitment buttons, the Big One, day points. Scarcity keeps it sacred.
export function Ritual({ size = 14, color = colors.goldDeep, bold = false, letterSpacing = 3, style, ...rest }: TextProps & { size?: number; color?: string; bold?: boolean; letterSpacing?: number }) {
  return <Text {...rest} style={[{ fontFamily: bold ? fonts.ritualBold : fonts.ritual, fontSize: size, color, letterSpacing }, style]} />;
}

export function Mono({ size = 13, color = colors.inkDim, letterSpacing = 0.5, style, ...rest }: TextProps & { size?: number; color?: string; letterSpacing?: number }) {
  return <Text {...rest} style={[{ fontFamily: fonts.mono, fontSize: size, color, letterSpacing }, style]} />;
}

export function Eyebrow({ children }: { children: string }) {
  return <Mono size={10} color={colors.goldDeep} letterSpacing={4} style={{ textTransform: "uppercase", textAlign: "center" }}>{children}</Mono>;
}
