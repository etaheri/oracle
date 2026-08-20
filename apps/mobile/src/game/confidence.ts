import { CONSTANTS as C } from "@oracle/core";

export function snapConfidence(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  const steps = (C.CONFIDENCE_MAX - C.CONFIDENCE_MIN) / C.CONFIDENCE_STEP; // 8
  return C.CONFIDENCE_MIN + Math.round(clamped * steps) * C.CONFIDENCE_STEP;
}

const READINGS: Record<number, string> = {
  55: "A WHISPER OF A HUNCH", 60: "THE MISTS STIR", 65: "AN OMEN TAKES SHAPE",
  70: "THE PATTERN EMERGES", 75: "THE SIGNS ARE CLEAR", 80: "THE STARS ALIGN",
  85: "THE VISION IS VIVID", 90: "FATE WHISPERS ITS ANSWER", 95: "THE PROPHECY IS CERTAIN",
};

export function confidenceReading(c: number): string {
  return READINGS[c] ?? READINGS[75]!;
}
