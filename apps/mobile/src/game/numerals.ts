// Pure — lives outside CardChrome.tsx so node tests (vitest chokes on the
// RN imports in a .tsx file) can import it without dragging in react-native.
// Fifteen entries: five for the card's own slots, the rest so the Rites
// number in Ritual numerals throughout instead of falling back to arabic
// partway down the list. Keep this at least RITES_LINES.length — the rites
// test asserts it.
export const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"] as const;
export function numeral(slot: number): string {
  return NUMERALS[slot - 1] ?? String(slot);
}
