// Fortune is unit-less by design (design §15). Thousands are grouped so 1240
// reads as money and not as a score; a loss carries a true minus sign, never
// the ASCII hyphen -- these are receipts.
export function formatFortune(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US");
  return n < 0 ? `−${abs}` : abs;
}

export function signedFortune(n: number): string {
  if (n > 0) return `+${formatFortune(n)}`;
  if (n < 0) return formatFortune(n);
  return "0";
}

// The board carries return in basis points so the wire stays integer.
export function returnPct(bp: number): string {
  const pct = (Math.abs(bp) / 100).toFixed(1);
  return bp > 0 ? `+${pct}%` : bp < 0 ? `−${pct}%` : `${pct}%`;
}
