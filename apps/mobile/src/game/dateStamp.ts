// The system header's right-hand stamp: the round's own date, punctuated the
// way the rest of the chrome punctuates (middot, never slashes). Pure so the
// header renders the same string on every platform and clock.
export function dateStamp(isoDate: string): string {
  const parts = isoDate.slice(0, 10).split("-");
  if (parts.length !== 3 || parts.some((p) => p === "" || !/^\d+$/.test(p))) return "";
  const [y, m, d] = parts;
  return `${y}·${m.padStart(2, "0")}·${d.padStart(2, "0")}`;
}
