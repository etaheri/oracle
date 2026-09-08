# ORACLE forecasting additions roadmap

Updated September 7, 2026. Product roadmap from the superforecasting discussion. Future entries are proposals, not implementation commitments.

## Direction

Make the daily game worth returning to because players enjoy making a call, facing the reveal, and understanding their own judgment over time. Keep the five-question daily round central. Add depth through useful feedback and a trustworthy Oracle opponent before adding new modes.

The highest-value launch additions are already merged into local main: factual confidence history, clearer reveal feedback, and forecasts sealed before play. Test those with players before expanding scope. Merged code is not the same as a deployed release.

## What is already implemented

| Addition | Player or operational value | Status and limits |
| --- | --- | --- |
| **Confidence history** | “Of your 40 calls at 80% confidence, 29 were right.” Gives players a record beyond rank. | Merged in `0faa164`. Exact confidence buckets, lifetime resolved calls, expandable counts. A bucket needs 20 calls for a headline; that is a display rule, not proof of skill. |
| **Reveal scoring explanations** | Shows how confidence affected base points, including Big One weight and applicable Oracle comparison. | Merged in `0faa164`. A single miss does not establish that the forecast was poor. |
| **Resolution evidence** | Lets players inspect why a question resolved as it did. | Merged in `0faa164`. Optional stored quote with its paired source URL. This is outcome evidence, not a lesson about what was knowable before sealing. |
| **Feature analytics** | Helps evaluate whether players notice and use the new feedback. | Instrumentation merged in `0faa164`; meaningful usage still depends on rollout and actual play. |
| **Fair Oracle commitment** | Ensures the opponent cannot forecast after players start answering or revise its committed position. | Merged in `4fe7542`. All five probabilities commit atomically before opening, with model, prompt version and question snapshot. Committed questions cannot be edited or rerolled. |
| **Learning architecture** | Provides a concrete technical path for improving the Oracle. | Design document merged in `4fe7542`; automated evaluation, shadow forecasting and promotion are not implemented. |

If the Oracle misses its preparation deadline, the round still opens without a new Oracle duel. Historical forecasts are preserved, but are not retroactively certified as having been committed before opening.

## Priority 0 — release and test the current additions

Apply migration `0009_mighty_big_bertha.sql` before deploying the updated API. Roll out the compatible API before the mobile build. Follow the existing launch playbook for the rest of release verification.

Observe five new players through a round and reveal. Use clearly labeled seeded histories to test the confidence display without waiting weeks for enough calls. Look for whether players can explain confidence versus correctness, interpret the counts, and understand the result without extra instruction. Four of five understanding these ideas is a formative usability target, not statistical validation.

Check empty, building, resolved, pending, void and missing-Oracle states. Watch whether the additions help players return after a loss and keep the daily game easy to reach. Instrumentation can describe engagement; it does not prove better forecasting.

**Exit condition:** the new flow is understandable, the deployed commitment path works, and observed confusion has been addressed. No additional game mode is needed for this stage.

## Priority 1 — teach from evidence available before the seal

**Proposal:** an optional, short reveal lesson built from a verified base rate or a material piece of evidence available before play. For example: “In the cited comparison set, this happened in 3 of 10 cases.” Include the definition of the comparison set and its source; do not invent a base rate to make every reveal educational.

**Why:** this extends outcome verification into useful reasoning practice. It adds something players can apply to their next call.

**Technical work:** extend authoring to preserve a timestamped evidence snapshot, source excerpts, the reference class when relevant, and an optional reviewed lesson. Validate provenance and seal the lesson inputs with the question. Render it through the existing optional reveal detail. Outcome evidence and pre-seal evidence must remain distinguishable.

**Done when:** each displayed lesson has support from the stored pre-seal record; questions without a sound lesson simply omit it; wording avoids hindsight and does not treat a surprising outcome as proof of a bad prediction.

**Scope:** one useful observation, not a generated essay or required course. This is the first proposed player-facing addition after launch feedback.

## Priority 1 — measure the Oracle before making it learn

**Proposal:** a deterministic evaluation job over timestamped forecasts and resolved outcomes.

**Why:** identify whether the Oracle is overconfident, unreliable in particular conditions, or missing rounds before changing its behavior. A model reviewing its own reasoning is not a substitute for measured results.

**Technical work:** use TypeScript and SQL on Neon/Postgres. Record versioned runs, compute Brier loss, confidence counts and coverage, and save evaluation snapshots. Exclude pending/void questions from scored rows while reporting their counts. Separate legacy data with unknown commitment timing. Keep player engagement analytics separate from the authoritative forecast record.

**Done when:** scores can be reproduced from stored probabilities and outcomes, corrections are handled explicitly, and missing/late forecasts remain visible. Small samples must remain descriptive.

**Scope:** internal report first. No new agent framework, fine-tuning system or public “learning” claim required.

## Priority 2 — improve the Oracle through shadow experiments

**Proposal:** run a candidate forecaster alongside the live Oracle, without affecting competitive outcomes.

**Technical path:** keep the existing Claude adapter and Zod validation; use a Cloudflare Workflow where durable retries help. Add versioned forecast runs and evidence records. Start with a simple calibration candidate fitted on older outcomes, then evaluate it on later outcomes. Prompt or research changes require prospective forecasts before answers are known.

Compare live and candidate on the same questions and cutoff, including coverage, paired Brier differences and uncertainty. Review promotion to a new active version; preserve all historical commitments. Give experiments a separate bounded budget so they cannot delay the daily round.

**Done when:** a frozen candidate demonstrates credible improvement on subsequent outcomes without sacrificing coverage. No universal small sample threshold is prescribed. If evidence is inconclusive, keep the live version.

See [Oracle learning: implementation path](../architecture/oracle-learning.md) for proposed tables, modules and code.

## Priority 2 — monthly seasons using the existing daily round

**Proposal:** give the accumulated record a monthly destination and a season recap. Reuse daily play rather than creating a second queue of questions.

**Why:** provides a longer-term reason to return once the core loop is working.

**Design before implementation:** define eligibility, minimum participation, missed-day treatment, tie rules, season boundaries, late resolutions, voids and corrections. Evaluate the incentives created by each rule, including selective participation. Keep forecasting accuracy separate from participation badges and purchasable benefits; do not silently repurpose the current rolling Oracle Score as a monthly score.

**Technical work:** prospective season rules, deterministic standings, a record of finalized results, and a lightweight recap in existing surfaces.

**Done when:** simulated histories produce understandable standings, players can explain what determines rank, and paying or grinding cannot purchase a forecasting advantage. Start without cash prizes.

**Trigger:** playtests and early usage show that players understand the daily result and want a longer competition.

## Priority 3 — a research or tournament partnership pilot

The colleague's idea is a business hypothesis: ORACLE could introduce more people to forecasting and potentially offer an opt-in route for promising players to a separate assessment or tournament. A high ORACLE rank alone does not establish that someone is a superforecaster or that skill transfers to different questions and time horizons.

[Forecasting Research Institute](https://forecastingresearch.org/) describes research on forecasting methods, expert studies and AI forecast evaluation. [Metaculus tournaments](https://www.metaculus.com/tournaments/) demonstrate topic-based competitions, including both prize and no-prize formats. These are distinct organizations and possible sources of inspiration; neither page establishes interest in backing ORACLE. Links reviewed September 7, 2026.

**Possible pilot:** a small themed season, educational collaboration, or optional referral to an independently assessed forecasting exercise. Define one measurable objective, such as qualified opt-in participation or comprehension, before building integration.

**Prepare first:** a playable demo, honest engagement evidence, documented scoring and question resolution, and a short pilot proposal explaining mutual value. Agree explicitly on consent and data scope before any player-record sharing. Explore sponsorship only after confirming partner interest; funding and endorsement are not assumed.

**Done when:** a partner agrees to a bounded pilot with a useful outcome for players and clear responsibilities. No partner outreach or integration has been performed as part of this work.

## Optional backlog — only when there is evidence of demand

| Idea | Potential value | Dependency |
| --- | --- | --- |
| Calibration chart with uncertainty | Makes longer-term patterns easier to inspect. | Enough observations and a phone-friendly explanation that survives usability testing. |
| Category-specific feedback | Helps players examine where their judgment differs. | Adequate samples per category; avoid noisy skill labels. |
| Short practice exercises | Lets players try base-rate reasoning without risking a competitive result. | Validated lesson material and demand beyond the existing practice flow. |
| Themed seasons or guest questions | Adds variety and supports a future collaboration. | Reliable authoring, resolution and season rules. |

Do not prioritize automatic prompt rewriting in production, crowd-informed competitive forecasts, public superforecaster certification, cash-prize infrastructure or a separate tournament platform now. Each adds commitments beyond the current launch question: is the daily game compelling and understandable?

## Recommended order

1. Release and playtest the merged work.
2. Improve reveal lessons where verified pre-seal evidence supports them; build internal Oracle evaluation in parallel when capacity permits.
3. Choose the next investment from observed needs: shadow experiments for forecasting quality, seasons for sustained competition.
4. Approach a potential partner with evidence and a bounded pilot.

This order is a recommendation, not a dated delivery promise. Prioritize fixes exposed by real testing over additional roadmap features.

## Supporting records

- [Launch playbook](../launch-playbook.md)
- [Earlier feature verification](forecasting-learning-launch-verification.md)
- [Commitment fix verification](oracle-commitment-verification.md)
- [Technical learning architecture](../architecture/oracle-learning.md)
- [Original implementation plan](../superpowers/plans/2026-09-07-forecasting-learning-launch.md) — historical planning artifact; its original proposed status and checkboxes do not supersede the merged status above.
