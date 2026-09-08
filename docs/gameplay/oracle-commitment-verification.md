# Oracle commitment verification

September 7, 2026. Local implementation; production migration and deployment not performed.

## Behavior

The scheduler attempts forecasting before opening, at 09:00, 10:00 and 11:00 ET under its existing minute throttle. PostgreSQL atomically commits all five probabilities, the exact question snapshot, model and prompt version. It rejects late or changed snapshots and preserves the first successful commitment. Committed content cannot be edited or rerolled. Existing resolution and early-outcome protection remain supported. Public prediction submission requires an open question, an open parent round, and the opening time to have passed.

A round without an eligible forecast still opens; it has no new Oracle duel. Legacy forecasts remain unchanged and have no newly asserted commitment provenance. Apply migration 0009 before deploying the updated Worker.

## Verification

- Type checking passed across core, API and mobile.
- Full API run: 541/542 passed, with one five-second timeout in the compose suite. Its unchanged suite passed all 11 tests on isolated rerun. Core (149) and mobile (328) passed in the workspace run; neither has implementation changes in this fix.
- Forecast and prediction regression suites passed (32 tests); settlement fixtures now submit within each round's open window and assert successful submissions (17 tests passed).
- Read-only review identified and then verified fixes for premature public submissions and a database lock-order conflict.
- Separate sessions against an isolated local PostgreSQL 14 database verified all six scenarios below. The temporary server was stopped afterward.

1. Concurrent commitments: first writer wins; all five probabilities remain unchanged.
2. Edit before commitment: stale snapshot rejected without deadlock.
3. Edit waiting behind commitment: immutable guard rejects the edit.
4. Concurrent sixth-question insertion: rejected after commitment; no phantom addition.
5. Parent-lock wait crosses opening time: no probabilities or metadata committed.
6. Injected failure on the third probability write: all five writes and metadata roll back.

The learning architecture in `docs/architecture/oracle-learning.md` is a proposal. This fix supplies a trustworthy forecast record; automated evaluation, shadow candidates and promotion are not implemented.
