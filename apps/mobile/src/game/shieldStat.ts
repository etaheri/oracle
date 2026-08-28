// Ledger plaque stat: the shield reserve, machine voice. Pure — node-tested.
export function shieldStat(freeAvailable: boolean, paid: number): string {
  const parts: string[] = [];
  if (freeAvailable) parts.push("1 FREE");
  if (paid > 0) parts.push(`${paid} PAID`);
  return parts.length ? parts.join(" + ") : "NONE UNTIL NEXT MONTH";
}
