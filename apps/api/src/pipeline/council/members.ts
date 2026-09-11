// The Council's members (design 2026-09-11 §3). A static table; adding a
// member is one row. The market member is a baseline, never sent to a model,
// and is not listed here — commit.ts writes its row from questions.market_prob.
import type { ModelMemberId } from "@oracle/core";
import type { PipelineDeps } from "../index";

export const COUNCIL_PROMPT_VERSION = "council-v1";
export const LESSON_PROMPT_VERSION = "lesson-v1";

const DEFAULT_MODELS: Record<ModelMemberId, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
  haiku: "claude-haiku-4-5-20251001",
};
const DEFAULT_LESSON_MODEL = "claude-haiku-4-5-20251001";

export function memberModel(deps: PipelineDeps, member: ModelMemberId): string {
  return deps.councilModels?.[member] ?? DEFAULT_MODELS[member];
}

export function lessonModel(deps: PipelineDeps): string {
  return deps.councilModels?.lesson ?? DEFAULT_LESSON_MODEL;
}
