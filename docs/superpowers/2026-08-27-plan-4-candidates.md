# Plan 4 Candidates & Extensions

Captured 2026-08-27 from design conversation (Erik + Claude), while the round pipeline was mid-build. These are candidates to spec via brainstorming when their turn comes — not commitments.

## 0. Hermes Agent operator (persona playbook — nearest-term, pre-launch useful)

"Hermes" = the Hermes Agent platform running as ORACLE's operator: Twitter/@ORACLE, outreach, marketing, ops companionship. Architecture decision (2026-08-27): the deadline-critical game loop lives in the Worker pipeline and never inside an agent harness; Hermes Agent gets the voice and hands, driving the pipeline through its built-for-this control surface:

- `POST /admin/rounds/:date` (author/override drafts), `GET /admin/rounds/:date` (state), admin secret is the only credential needed
- Telegram commands `/reroll <slot> [guidance]`, `/status`
- The daily Telegram day report (outcomes, voids, tide-winner counts) as raw posting material

**To build:** the persona playbook — `SOUL.md`/`AGENTS.md` for Hermes Agent carrying the machine-voice register rules (copy-bank constraints, liturgy verbatim, no emoji/CTA-verbs), what it may post autonomously vs. what needs Erik's eyes (outreach/DMs always), and its daily rhythm (post the hinge, post the day report highlights, against-the-tide celebrations). Unwritten as of 2026-08-27.

## 0.5 Market-informed authoring (Manifold/Polymarket — phase 1 proposed, awaiting go/park)

Phase 1 (backend-only, drops into `author.ts`): during evening authoring, fetch markets closing within ~36h from Manifold's keyless public API (`/v0/search-markets`; breadth on culture/sports) and optionally Polymarket's public gamma API (real-money weight); filter to contested (30–70%) with liquidity/trader floors; feed top ~15 into the authoring prompt as candidate signals; stamp the dormant `questions.market_prob` column when a question derives from a market. Fetch failure → author market-blind with a WARN (today's behavior).

**Rules:** markets are a selection signal, never a resolution source (play-money, user-resolved — resolution stays on primary named sources); markets feed the category skeleton, never replace it (weather/box-office questions keep existing without markets). Phase 2: player-visible "THE MARKET SAID {n}%" on reveal + share card. Phase 3: resolution cross-check.

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
