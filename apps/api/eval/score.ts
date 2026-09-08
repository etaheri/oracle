// Gate scoring (design 2026-09-08 §8.1).
//
// ASYMMETRIC ON PURPOSE. These gates do not have one error rate, they have
// two, and the two cost wildly different amounts:
//
//   false PASS on taste     → a tasteless question reaches every player.
//   false REJECT on taste   → one candidate thrown away, absorbed by surplus.
//
// Reporting a single accuracy number over a gate this asymmetric would hide
// the only error anybody cares about, which is why there is no accuracy number
// in this file.
export interface Confusion { truePass: number; trueReject: number; falsePass: number; falseReject: number }

export function score(cases: { expected: "pass" | "reject"; actual: "pass" | "reject" }[]): Confusion {
  const c: Confusion = { truePass: 0, trueReject: 0, falsePass: 0, falseReject: 0 };
  for (const k of cases) {
    if (k.expected === "pass" && k.actual === "pass") c.truePass += 1;
    else if (k.expected === "reject" && k.actual === "reject") c.trueReject += 1;
    else if (k.expected === "reject" && k.actual === "pass") c.falsePass += 1;
    else c.falseReject += 1;
  }
  return c;
}

/** False passes lead, because they are the error that costs something. */
export function formatConfusion(gate: string, c: Confusion): string {
  const n = c.truePass + c.trueReject + c.falsePass + c.falseReject;
  return [
    `${gate.toUpperCase()} — ${n} cases`,
    `  false-pass   ${c.falsePass}   ← the expensive error`,
    `  false-reject ${c.falseReject}   (absorbed by surplus)`,
    `  correct      ${c.truePass + c.trueReject}`,
  ].join("\n");
}
