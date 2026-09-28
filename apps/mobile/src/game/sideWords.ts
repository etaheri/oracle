// Storage says yes and no; a hot take is agreed or disagreed with (design
// 2026-09-25 N1). Every side word a player reads comes through here, keyed on
// the question's own flag and never on its source name. `room` is that flag,
// renamed at the call site so no player string ever interpolates the wire's
// own word for it.
export function sideWord(answer: boolean, room: boolean): string {
  if (room) return answer ? "AGREE" : "DISAGREE";
  return answer ? "YES" : "NO";
}

export function outcomeWord(outcome: "yes" | "no", room: boolean): string {
  if (room) return outcome === "yes" ? "AGREED" : "DISAGREED";
  return outcome === "yes" ? "YES" : "NO";
}

export function shareSoFar(pct: number, room: boolean): string {
  return room ? `${pct}% AGREE` : `${pct}% SAY YES`;
}
