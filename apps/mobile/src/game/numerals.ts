// Pure — lives outside CardChrome.tsx so node tests (vitest chokes on the
// RN imports in a .tsx file) can import it without dragging in react-native.
export const NUMERALS = ["I", "II", "III", "IV", "V"] as const;
export function numeral(slot: number): string {
  return NUMERALS[slot - 1] ?? String(slot);
}
