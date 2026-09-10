# The House — plan sequence

September 10, 2026. Spec: `docs/superpowers/specs/2026-09-10-the-house-design.md`. Deadline: Shipaton submission, September 30, 2026.

The spec is one design delivered as three plans. Each plan ships working software on its own and each later plan builds on signatures the earlier one fixes. Written plans are listed with their path; unwritten plans are described by scope and are written only after the plan before them has landed, so their tasks use real code rather than guessed names.

| # | Plan | Status | Spec sections | Delivers | Depends on |
| --- | --- | --- | --- | --- | --- |
| 1 | Foundation | Written: `2026-09-10-the-house-foundation.md` | 4, 5, 6, 7, 11 | Exchange-fed version 3 rounds, the house line, stakes from fortune at seal, exchange settlement, fortune payout, house delta, every API field the app needs. Retires the probe and the gauntlet. | Nothing. Starts now. |
| 2 | Mobile | Not written | 8, and the §7 rows for the all-time board and the practice fortune | The card line, the stake readout, the reveal headline and per-card stake/payout, home with fortune and the house line, the daily board by return and the all-time board by fortune, the ledger's fortune history, the share card, practice on a fixed fortune, the rewritten rules. Two small API additions: the all-time board route and the practice fortune on the exhibition route. | Plan 1's routes and schema fields. |
| 3 | The Council | Not written | 13, 14, 5.4b, 12 | Multi-member line commit with abstention and a median, the shared Exa evidence pack per question, each member's reasoning and cited evidence, per-member lessons with the as-of rule, the public standings route and site page with the CSV record, the reveal's Council split and the Oracle's reading. Also the resolver date-anchoring fix for bank questions, since bank questions are the only ones that still use the model resolver. | Plan 1's `lines`-shaped commit step and `questions.line_p_yes`; Plan 2's reveal for the Council split and reading UI. The standings page and CSV do not need Plan 2. |

## Order and calendar

Plan 1, then Plan 2, then Plan 3, in that order. Plan 2 is what makes the game playable as designed; Plan 3 is what makes the pitch verifiable. If the calendar forces a cut, Plan 3's standings route and site page are the part to keep, because the research pitch and the "man versus machine is true" claim rest on them, and they need no mobile work. The Council's multi-member commit can ship with a single member and grow later; the table shape admits it.

Rough shape against the deadline, assuming subagent-driven execution and one operator reviewing:

- Plan 1: three to four working days. Cutover per the launch playbook §2.3 as soon as it lands, so a real version 3 round runs while Plan 2 is built.
- Plan 2: four to five days. Ships to TestFlight when the reveal and the card are right; the rest of the screens can follow in a second build.
- Plan 3: three to four days. The standings route and site page first, the evidence packs and memory second, the reading UI last.

That leaves under a week of slack before September 30. The Council sits pre-noon state (spec §8, marked stretch) is the first thing cut.

## What is not in any plan

Seers and Visitors as Council members, a moving line, a named currency, seasons or friend boards, and exchange-sourced bank questions. See spec §15.

## Operational state at the time of writing

- Production pipeline paused: `PIPELINE_ENABLED` is `false` on the deployed worker. It stays false until Plan 1's cutover.
- Production database `oracle-prod` on Neon holds one player. Migrations are applied by hand; the repo is at 0013 and Plan 1 adds 0014.
- The September 9 round has one voided question (the 49ers game) and four open ones that will never lock while the cron is off. It can be settled by hand through the admin routes after cutover, or left as it is.
