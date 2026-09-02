import { useWindowDimensions, PixelRatio } from "react-native";
import { cappedScale } from "../game/typeScaling";

// The capped font scale, re-read when the window changes. useWindowDimensions
// re-renders on the OS text-size change that also changes getFontScale(), so
// a reserved slot sized from this stays correct without its own listener.
export function useChromeScale(): number {
  useWindowDimensions();
  return cappedScale(PixelRatio.getFontScale());
}
