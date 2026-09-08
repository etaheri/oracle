// The `pnpm eval` entry point (design 2026-09-08 §8.2, task 14).
//
// Dispatches on argv[2] to one of the three gate evals below, or `all`. This
// harness is the one thing in this repo, besides the pipeline's own daily
// spend, that makes real Anthropic API calls with a dollar cost — so it
// prints an estimate of what it is about to spend BEFORE it spends anything,
// and its own env check fails with a plain, named sentence rather than a
// stack trace, with ZERO network calls made when it fails.
//
// Each gate is still a standalone script — critic.eval.ts, taste.eval.ts and
// resolver.eval.ts all run directly with
// `ANTHROPIC_API_KEY=... npx tsx eval/<gate>.eval.ts` — and this file spawns
// them as CHILD PROCESSES rather than importing them. Importing would run
// them immediately as a side effect of module load (each ends in its own
// unconditional `main().catch(...)`), which would defeat the dispatch
// entirely and the env check above along with it. Spawning also means one
// gate's failure can never corrupt another's module state.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Gate = "critic" | "taste" | "resolver";
const GATES: Gate[] = ["critic", "taste", "resolver"];
const DEFAULT_SAMPLE = 10;

function sampleFlag(argv: string[]): number {
  const i = argv.indexOf("--sample");
  if (i === -1) return DEFAULT_SAMPLE;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`eval: --sample must be a positive number, got ${argv[i + 1]}`);
    process.exit(1);
  }
  return n;
}

// What each gate is documented to spend. critic and taste each make ONE
// batch call over their whole fixture set (see their own file headers); the
// resolver's disagreement half is a free query and its re-resolution half is
// exactly --sample calls, one per sampled question.
function callsFor(gate: Gate, sample: number): number {
  return gate === "resolver" ? sample : 1;
}

function estimate(gates: Gate[], sample: number): string {
  const parts = gates.map((g) => `${g}: ${callsFor(g, sample)}`);
  const total = gates.reduce((sum, g) => sum + callsFor(g, sample), 0);
  return `estimated model calls: ${total} (${parts.join(", ")})`;
}

function requireEnv(name: string): void {
  if (!process.env[name]) {
    console.error(`eval: ${name} is not set`);
    process.exit(1);
  }
}

// Spawned, not imported — see the file header. Inherits stdio so each gate's
// own output (and its own stack trace, if it has one) reaches the terminal
// exactly as it would running the gate directly.
function runGate(gate: Gate, extraArgs: string[]): number {
  const scriptPath = join(__dirname, `${gate}.eval.ts`);
  const result = spawnSync("tsx", [scriptPath, ...extraArgs], { stdio: "inherit" });
  if (result.error) {
    console.error(`eval: failed to spawn ${gate}.eval.ts: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function main(): void {
  const selection = process.argv[2];
  const rest = process.argv.slice(3);

  if (selection !== "critic" && selection !== "taste" && selection !== "resolver" && selection !== "all") {
    console.error("eval: usage: pnpm eval <critic|taste|resolver|all> [--sample N]");
    process.exit(1);
  }

  const sample = sampleFlag(rest);
  const gates: Gate[] = selection === "all" ? GATES : [selection];

  // THE CHECK, BEFORE ANYTHING SPENDS A CENT. Named per-variable, never a
  // stack trace, and no child process is spawned — no network call is
  // possible — if either is missing. This must run before estimate() and
  // before any runGate() call below, not delegate to a gate's own guard,
  // because a gate's own guard only fires after tsx has already started it.
  requireEnv("ANTHROPIC_API_KEY");
  if (gates.includes("resolver")) requireEnv("DATABASE_URL");

  console.log(estimate(gates, sample));

  if (selection === "all") {
    // design §8.3: pre-flight is measured by the leak tripwire in
    // src/pipeline/leak.ts, NOT here. "Was this answerable on date X" cannot
    // be re-run after the fact — the web has moved on since — and a fixture
    // set for it would look like measurement without being any.
    console.log("preflight: measured by the leak tripwire in src/pipeline/leak.ts, not this harness.");
  }

  let exitCode = 0;
  for (const gate of gates) {
    const args = gate === "resolver" ? ["--sample", String(sample)] : [];
    const status = runGate(gate, args);
    if (status !== 0) exitCode = status;
  }
  process.exit(exitCode);
}

main();
