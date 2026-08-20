import { Text, type TextProps } from "react-native";
import { colors, fonts } from "../theme";

export function Serif({ size = 18, color = colors.bone, style, ...rest }: TextProps & { size?: number; color?: string }) {
  return <Text {...rest} style={[{ fontFamily: fonts.serif, fontSize: size, color }, style]} />;
}

export function Mono({ size = 13, color = colors.boneDim, letterSpacing = 0.5, style, ...rest }: TextProps & { size?: number; color?: string; letterSpacing?: number }) {
  return <Text {...rest} style={[{ fontFamily: fonts.mono, fontSize: size, color, letterSpacing }, style]} />;
}

export function Eyebrow({ children }: { children: string }) {
  return <Mono size={10} color={colors.gold} letterSpacing={4} style={{ textTransform: "uppercase", textAlign: "center" }}>{children}</Mono>;
}
