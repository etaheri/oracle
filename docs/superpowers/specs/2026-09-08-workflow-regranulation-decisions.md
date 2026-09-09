# Workflow Re-granulation — Decisions Log

**Date:** 2026-09-08
**Spec:** `2026-09-08-workflow-regranulation-design.md`
**Branch:** `workflow-regranulation` (24 commits, `f7f6649..435f369`)

Every judgement call made while executing the plan, with what each costs if
wrong. Recorded because the interesting part of this work is not the diff — it
is which things turned out to be wrong, and who caught them.

---

## Decisions taken during execution

**1. `runResolution`'s return type changed, breaking a test.** `void` →
`ResolveOutcome[]` broke `pipeline-resolve.test.ts:427`'s
`resolves.toBeUndefined()`. Relaxed that one assertion to
`toBeInstanceOf(Array)` — the test's subject is that a non-budget error does not
reject; the `undefined` was incidental. The neighbouring budget-propagation test
was fenced off explicitly. *Cost if wrong: one test asserts slightly less.*

**2. `runProbe`'s return type changed, breaking three count assertions.**
Rewrote each as `(await runProbe(...)).filter(o => o.healed).length`, preserving
their exact meaning over the new type. *Cost if wrong: none.*

**3. `as const satisfies` might not typecheck.** Pre-authorised dropping
`as const`. **Never exercised** — it compiled fine.

**4. The plan contained a vacuous test.** Its workerd test declared
`let attempts = 0`, never incremented it, then asserted on it. Deleted. The
implementer replaced it with something better than requested: `mockStepError`'s
`times: 1` exhaustion, validated against a retryable policy to prove it
discriminates.

**5. The plan's timeout test could not catch the bug it existed for.**
`expect(p.timeout).not.toBe("10 minutes")` passes for `"15 minutes"`. The whole
purpose of `steps.ts` is that no step inherits *or exceeds* the default. Ruled
the finding wins over the plan text; now parses durations and asserts `< 600`
seconds, throwing on an unrecognised format. *Cost if wrong: none — strictly
stronger.*

**6. Overruled a reviewer whose diagnosis was right but whose fix was not.**
It correctly caught an inline step-config literal violating the
"config comes from POLICY, never a literal" rule. But its prescribed fix —
promote it to `POLICY` — would have put a `"10 minutes"` value inside the object
whose own test asserts every timeout is *under* ten minutes, forcing either a
weakened test or an exemption. Deferred to the task that deletes it anyway, and
wrote the deletion into that task's brief as a required step. **Satisfied** by
Task 9. *Cost if wrong: one duration string outside the parser's coverage.*

**7. `retries.delay` was never validated, only `timeout`.** Since `durableStep`
casts the whole config, a malformed delay reached the engine unchecked. Fixed.

**8. Admin workflow routes work even when `PIPELINE_ENABLED` is false.** Kept.
The pipeline being off is usually the *consequence* of an incident, not a reason
to withhold the tool for diagnosing it. Guarded by `ADMIN_SECRET`; an absent
binding returns 503. *Cost if wrong: an operator can read workflow state on a
deployment where the pipeline is off.*

**9. The mocking API cannot reach the defect it was added to prove.**
`mockStepError`/`mockStepResult` bypass a step's real callback, so no workerd
test can reach `durableStep`'s `BudgetExhausted → NonRetryableError` mapping —
defect §1.3, the one that mattered most. Closing it "properly" would have needed
a live database already over its ceiling; the implementer declined to mutate the
shared dev DB and asked. Correct call. Ruled: test the mapping as a pure unit
instead (`durableStep` takes `step` as a parameter), including the negative case
— an ordinary error must propagate **unwrapped**, or every transient failure
becomes non-retryable. *Cost: `durableStep` is exported for testing.*

**10. Treated both "minor" eval findings as fix-worthy.** This task's subject is
measurement quality, so an instrument with a cosmetic flaw is not cosmetically
flawed. Included the fixture critique below.

**11. `tsx` was never declared.** `pnpm eval` worked only because pnpm hoisted
it as someone else's transitive dependency — the classic works-on-my-machine
failure. The constraint said "no new npm dependencies"; its *intent* was
"nothing new ships to the Worker," and a devDependency does not ship. Declared
explicitly at the already-resolved version.

**12. `spend.ts`'s central claim was not literally true.** Its header asserts
"THE CEILING, APPLIED IN ONE PLACE — every model call in this pipeline goes
through that one object." An operator's Telegram `/reroll` reaches `rerollSlot`
with the **unmetered** `deps.pipeline`, so it calls Anthropic without
`meterClaude`. Pre-existing, out of scope, and the spec leans on that claim to
justify keeping `ClaudeClient` one-method. Fixed the **comment**, not the
behaviour — see Open Questions.

**13. Final-review triage.** Fixed: the three comment-truthfulness findings, the
unused import, the `.catch` hardening, and the missing typecheck coverage.
Accepted as-is: four findings that are each either true-as-written or inert.

---

## What the process caught that a single pass would not

- **A reviewer caught a weakness in the plan, not the code** (#5). The
  implementer transcribed the brief faithfully; the brief was wrong.
- **"tsc is clean" concealed the wrong fix.** One task achieved a clean
  typecheck by padding seven test fakes with an unused method — an approach
  explicitly ruled out. Only knowing what the failure *was* made a clean result
  without the segregated interface look suspicious.
- **An implementer corrected the plan.** `NonRetryableError` lives in
  `cloudflare:workflows`, not `cloudflare:workers`.
- **An accidental interlock.** `StepPolicy` types durations as plain `string` so
  `steps.ts` stays free of workerd imports; `durableStep` casts at the boundary,
  which disables type checking on those strings. What actually validates them is
  the test from #5 — written for an unrelated reason. Hence the rule: step config
  comes from `POLICY`, never an inline literal, because the parser only sees
  policies.
- **The "hard" eval fixtures were not hard.** The labelled near-the-line pair
  (a Pope's hospitalisation vs. a Fed Chair's resignation) restated the taste
  prompt's own explicit clauses. Replaced with genuinely conflicting cases.
- **`git stash` in a review nearly destroyed in-flight work.** A reviewer stashed
  and restored a tree holding another agent's uncommitted fix. It round-tripped
  correctly, but that was luck. Review dispatches now forbid mutating the tree.

---

## Open questions for a human

**1. Should an operator's `/reroll` be metered?** It currently reaches Anthropic
without passing through the ceiling (#12). It is human-triggered and low-volume,
so it is not the unattended retry storm the ceiling exists to bound — but it
still spends real money, and currently spends it invisibly. A reasonable
position is that it should **count** but not **block**.

**2. `taste.ts`'s prompt is under-specified, and building the eval proved it.**
It forbids "medical outcomes of named people" flatly while blessing "public
figures' professional outcomes". An athlete's return-from-injury clearance is
literally both. Two careful readers — the implementer and its reviewer —
independently landed at roughly 50/50 on the correct verdict. That is not one
agent being uncertain; it is a spec that does not decide. As written, the gate
will refuse legitimate sports questions. The clause likely needs a
grave-versus-routine distinction. Both fixture cases are marked
`"contested": true` so a future miss reads as "the fixture may be wrong" rather
than "the gate is broken".

---

## Verified at `435f369`, clean tree

| Check | Result |
|---|---|
| PGlite suite | 52 files / 582 tests |
| workerd suite | 1 file / 3 tests |
| `tsconfig.json`, `test/`, `eval/`, `workflows-test/` | all clean |
| `wrangler deploy --dry-run` | builds; all three Workflow classes bound |

Baseline before this work was 552 tests.

**Still unverified, and stated in spec §7.3:** no test proves the real Workflow
engine routes a genuine `BudgetExhausted` through `durableStep`'s callback. The
mapping is proven in isolation; its invocation by the engine is not.
