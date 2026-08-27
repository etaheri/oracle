// Claude client contract for the pipeline (spec §5-7). Task 5 adds
// makeClaudeClient's implementation to this same file; this task ships only
// the interfaces so author.ts/resolve.ts stubs and PipelineDeps can type
// against them.
export interface StructuredCall {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  webSearch?: { allowedDomains?: string[]; maxUses?: number };
}
export interface ClaudeClient { structured(call: StructuredCall): Promise<unknown> }
