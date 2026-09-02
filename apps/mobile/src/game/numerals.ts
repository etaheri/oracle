// Pure — lives outside CardChrome.tsx so node tests (vitest chokes on the
// RN imports in a .tsx file) can import it without dragging in react-native.
// Twelve entries: five for the card's own slots, the rest so the Rites
// (twelve rules, spec §6) number in Ritual numerals throughout instead of
// falling back to arabic partway down the list.
export const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;
export function numeral(slot: number): string {
  return NUMERALS[slot - 1] ?? String(slot);
}
