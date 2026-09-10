import { formatFortune } from "./fortuneText";

// Home's second line (design §8.3): whether the house won or lost last night,
// and, when the purse has gone negative, the debt. Machine register.
export function houseLines(house: { total: number; last_delta: number | null } | null | undefined): string[] {
  if (!house || house.last_delta === null) return [];
  const d = house.last_delta;
  const night = d > 0 ? `LAST NIGHT THE HOUSE WON ${formatFortune(d)}` : d < 0 ? `LAST NIGHT THE HOUSE LOST ${formatFortune(-d)}` : "LAST NIGHT THE HOUSE BROKE EVEN";
  return house.total < 0 ? [night, `THE ORACLE OWES ITS PLAYERS ${formatFortune(-house.total)}`] : [night];
}
