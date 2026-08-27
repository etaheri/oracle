// Stub until Task 7 wires Claude-driven question resolution (spec §6).
import type { PipelineDeps } from "./index";

export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean> {
  throw new Error("resolution not wired");
}
