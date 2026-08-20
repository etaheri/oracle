import { Platform } from "react-native";

export const colors = {
  obsidian: "#0C0A07",
  panel: "#12100B",
  bone: "#E9E1CD",
  boneDim: "#B5AC97",
  ash: "#8D8677",
  gold: "#C9A24B",
  goldBright: "#E4C878",
  oxblood: "#B04A38",
  line: "rgba(201,162,75,0.18)",
} as const;

export const fonts = {
  serif: Platform.select({ ios: "Didot", default: "serif" })!,
  mono: Platform.select({ ios: "Menlo", default: "monospace" })!,
};

export const space = (n: number) => n * 4;
