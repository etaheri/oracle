# Plan 4 Candidates & Extensions

Captured 2026-08-27 from design conversation (Erik + Claude), while the round pipeline was mid-build. These are candidates to spec via brainstorming when their turn comes — not commitments.

## 0. Hermes Agent operator (persona playbook — nearest-term, pre-launch useful)

"Hermes" = the Hermes Agent platform running as ORACLE's operator: Twitter/@ORACLE, outreach, marketing, ops companionship. Architecture decision (2026-08-27): the deadline-critical game loop lives in the Worker pipeline and never inside an agent harness; Hermes Agent gets the voice and hands, driving the pipeline through its built-for-this control surface:

- `POST /admin/rounds/:date` (author/override drafts), `GET /admin/rounds/:date` (state), admin secret is the only credential needed
- Telegram commands `/reroll <slot> [guidance]`, `/status`
- The daily Telegram day report (outcomes, voids, tide-winner counts) as raw posting material

**To build:** the persona playbook — `SOUL.md`/`AGENTS.md` for Hermes Agent carrying the machine-voice register rules (copy-bank constraints, liturgy verbatim, no emoji/CTA-verbs), what it may post autonomously vs. what needs Erik's eyes (outreach/DMs always), and its daily rhythm (post the hinge, post the day report highlights, against-the-tide celebrations). Written 2026-08-27: `docs/hermes/SOUL.md`.

**Hermes roles beyond marketing (added after market-authoring phase 1 shipped):**
- **Toolsmith** (on-demand): extend the machine's senses. The `MarketFeed` interface in `apps/api/src/pipeline/feeds.ts` is the contract — Hermes finds a verifiable source for a genre, writes the small adapter, proves it against fixtures, and opens the change for Erik's review. Sports schedules, weather stations, box office, Kalshi-with-key: each is one adapter, never a refactor.
- **Auditor** (scheduled, e.g. weekly): read the quality data the pipeline records — `market_prob` vs. actual crowd splits, voided questions (bad criteria), per-feed hit rates — and produce a report plus proposed tuning (feed weights, volume floors, prompt tweaks) as reviewed changes. The auditor may run on a schedule, but its output is always a report or a diff, never a runtime action.

**Separation of concerns (the standing rule):** the Worker cron OPERATES the game — deadline-bound, same code every day, writes to the database. Hermes EVOLVES the game — no deadline, judgment-heavy, writes to the repo (through review) or to Erik (reports). A task with a clock and runtime side effects belongs in deterministic Worker code; a task producing insight or code belongs in an agent, scheduled or on-demand. Cloudflare Workflows serves neither Hermes role: durable step execution can't write and test code, and the runtime side already has its durability from DB-state recomputation.

## 0.5 Market-informed authoring — PHASE 1 SHIPPED 2026-08-27 (commit 7643148)

`apps/api/src/pipeline/feeds.ts`: pluggable `MarketFeed` interface; Manifold (`/v0/search-markets`, binary + ≥5 bettors) and Polymarket gamma (`end_date`-bounded, volume ≥500) fetch keyless, filter to the 36h horizon, rank by trust (real money 1.0 > play money 0.6) × contestedness × log-volume, cap 15. Signals enter the authoring system prompt as a LIVE MARKET SIGNALS block; `market_prob` (0–1, nullable) rides the draft schema into the formerly dormant `questions.market_prob` column. Per-feed failure isolation; all-feeds-down → authoring proceeds market-blind. **Kalshi deferred:** its public endpoints null all prices without an RSA-signed key (verified live 2026-08-27) — joins as a drop-in `MarketFeed` when credentials exist.

**Rules (standing):** markets are a selection signal, never a resolution source; markets feed the category skeleton, never replace it. Phase 2 SHIPPED 2026-08-27 (commit 277d828): market_prob flows through the reveal API into the Big One block ("THE MARKET SAID 42% YES" under the crowd line) and the night share card. Phase 3 (unbuilt): resolution cross-check.

## 1. Oracle Pools (Duolingo-style leagues) — the D7 lever

Weekly pools of ~10–30 players ranked by day points, with promotion/relegation between tiers, plus invite-based friend pools. The strongest known retention mechanic for a daily ritual, aimed squarely at the mid-September kill/continue gate (D7 ≥ 20%).

**Design commitments made in conversation:**
- **The shared round is sacred.** No interest-based personalization of the daily five — crowd %, against-the-tide, and the share card all depend on everyone facing the same questions (one word, like Wordle). Interests may shape *pool composition* (a sports-flavored pool trash-talks the same round), never content.
- Composes with existing identity layer for free: epithets and calibration verdicts give pools personality.
- Depends on: real identity beyond device tokens (usernames at minimum), a social graph table, invite links. Pairs naturally with the already-deferred **rivalries** (see `2026-08-26-costar-dynamics.md`, deferred to Plan 4).

## 2. User-proposed questions with AI feasibility gate + resolution

Players propose questions; Hermes resolves them with the machinery the pipeline already ships (verify-or-void, source-restricted web search, evidence receipts — it works on any well-formed question, not just Hermes-authored ones).

**Shape agreed in conversation:**
- Proposals land in a candidates table. At submission, Hermes runs a **feasibility gate**: can it name a source, exact resolution criteria, and a next-day deadline? Does it pass the authoring system prompt's forbidden-topics contract? Accept/reject in the machine voice.
- The nightly authoring job draws from accepted proposals before inventing its own.
- When a player's question runs: "THE ORACLE HEARD YOU" (push copy candidate — must go through the voice spec's copy-bank lint rules).
- Sequence after launch; moderation risk is real and the feasibility gate is the control.

## Standing Plan 4 preconditions already recorded elsewhere (context, not candidates)

- `settleRound` retry-safety (per-user `streak_settled_through`) before any further settlement automation — comment in `apps/api/src/settlement.ts`. Cloudflare Workflows or a plain DO alarm was evaluated (2026-08-27) and deferred: the DB-state-derived cron pipeline already provides the durability; exactly-once step semantics only become interesting when solving settle atomicity.
- The four push-trigger obligations in `apps/api/src/push/compose.ts`.
- A migrate-script workflow for Neon (0001 was applied by hand).
- Bounded audience queries in settlement.
- Rivalries (Co-Star research doc).
