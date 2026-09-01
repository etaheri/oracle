import { Image } from "expo-image";
import type { Rect } from "../game/heroStage";

// The orb tile: a transparent animated WebP, 1:1. `playing={false}` shows
// frame 0 as a still — that is the boot rite's orb; Home's orb mounts with
// `playing` so its loop begins on frame 0, pixel-identical to the still that
// just arrived (expo-image `autoplay`, Expo SDK 57).
const ORB = require("../../assets/art/orb-loop.webp");

export function OrbLayer({ rect, playing }: { rect: Rect; playing: boolean }) {
  return (
    <Image
      source={ORB}
      autoplay={playing}
      contentFit="contain"
      style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      accessible={false}
    />
  );
}
