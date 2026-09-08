export type HomeActionGate = {
  generation: number;
  pending: boolean;
  focused: boolean;
};

export function beginHomeAction(gate: HomeActionGate): { gate: HomeActionGate; token: number } | null {
  if (gate.pending || !gate.focused) return null;
  const token = gate.generation + 1;
  return { gate: { generation: token, pending: true, focused: true }, token };
}

export function invalidateHomeAction(gate: HomeActionGate, focused: boolean): HomeActionGate {
  return { generation: gate.generation + 1, pending: false, focused };
}

export function ownsHomeAction(gate: HomeActionGate, token: number): boolean {
  return gate.focused && gate.pending && gate.generation === token;
}
