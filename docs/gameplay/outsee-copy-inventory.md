# Outsee copy inventory — Tasks 1 and 1B

Approved September 8, 2026. Source audit: `rg -n 'ORACLE|Oracle|OUTSEEN|Outseen' apps/mobile/src apps/mobile/app.json apps/site/public packages/core/src/copy.ts`, followed by streak, confidence, purchase, notification and error-state searches. The initial raw scan was saved at `/private/tmp/outsee-copy-before.txt` for this implementation session.

## Identity classification

- **App:** ORACLE wordmark, ORACLE OS boot, notification sender, Oracle Plus, OUTSEEN website → Outsee (OUTSEE wordmark).
- **Opponent:** The Oracle, oracle forecast, opponent duel labels → retained; AI forecasting explained in the reference; the home leads with a rivalry challenge.
- **Rating:** player ORACLE SCORE → Your forecast rating; opponent's rating → Oracle rating. Daily points, board rank and streak remain separate measures.
- **Internal:** `@oracle/*`, `oracle_score`, oracle forecast fields, URL schemes, bundle/package IDs, purchase products, persistence flags, asset filenames and configured URL destinations → retained.
- **Historical:** `RITES_LINES` / `OPENING_RITES_LINES` describe version 1, including its original multipliers. Current reference uses explicit `RITES_V2_SECTIONS`. Old-round owners must link `rules_version=1` explicitly.

## Journey coverage

| Surface | Source/export | Before | Player question | Replacement | Eligibility / trigger | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| Display identity | mobile app.json | ORACLE | What app is this? | Outsee | OS display only | Diff: slug, scheme, bundle IDs unchanged |
| Wordmark | MaterializeTitle / WORD | ORACLE | What app is this? | OUTSEE | Canvas and static fallback | Source review; native layout check remains |
| Header | SystemHeader | SYS · V1.0 | What app is this? | OUTSEE | Static header | Source review |
| Returning boot | BootRite / LINES | ORACLE OS / orb wakes / ledger opens | What is waking? | OUTSEE / THE ORACLE WAKES / YOUR NEXT CALL AWAITS | Existing boot gate | bootGate tests; flags unchanged |
| First install | CallingRite / CALLING_LINES | Five lore lines, ~13 seconds | Who is my opponent? | OUTSEE / MEET THE ORACLE / IT MAKES A CALL. SO DO YOU. | First-install flag only | calling tests; 900/450/800ms timing, visible skip, static continue |
| Home orientation and orb | index, OracleClock (other owner) | App/opponent conflated | What is this; what can I do? | Daily prediction game; THE ORACLE · CAN YOU OUTSEE IT?; current deadline/action | Arrival state and hydration | Controller/home owner |
| Participants | homeLines (other owner) | Players called oracles | Who else called? | MAKE THE FIRST CALL; 1 PLAYER; N PLAYERS | Actual distinct participant count | homeLines tests, home owner |
| First round | INTRO_LINES / rites | Tomorrow; only Oracle | How do I play? | Answer, confidence changes points, Oracle and other-player rank | Opening route | Core copy tests; static readable steps |
| Full reference | RITES_V2_SECTIONS / rites | Numbered tracked-caps wall derived from legacy strings | Why play; how do rules work? | Purpose first, six heading/body sections | Current reference by default | Core copy tests; mobile typecheck |
| Archived reference | RITES_LINES / rites | Implicit current-round version | Which rules applied then? | Explicit archived version-1 label | `all=1&rules_version=1` | Legacy copy assertions retained |
| Rites exit | rites / begin | Blind /round | Is live play still open? | Refetch today + mine, then shared arrival selector | At press; live/crowd → round, waiting → exhibition, failure → home | arrivalState tests; typecheck |
| Exhibition links | rites | PRACTICE THE PULL | Can I try now? | TRY AN EXHIBITION; immediate, unranked | `entry_point=first_round` or `how_to_play` | Source route review |
| Ledger identity | ledger | Forecaster's ledger | What have I kept? | Your ledger; Your predictions and results; HOW TO PLAY | Ledger screen | Typecheck |
| Skill rating | ledger / SCORE_GLOSS / scoreProgress | Oracle Score; all five | What does this number mean? | Your forecast rating; cumulative qualifying calls | Rating null versus earned; constants retained | scoreProgress and core tests |
| Opponent skill | ledger | THE ORACLE | Whose rating is this? | ORACLE RATING | Opponent rating payload | API fields untouched |
| Streak detail | ledger / COPY_BANK vigil | Unbroken noons | Is attendance accuracy? | One daily call; settlement updates; protection adds no played day | Actual streak | streak and copy-select tests |
| Shield aftermath | shieldNotice / streak.shield-1 | Survived missed noon | What did protection do? | Shared shieldUsed: preserved streak; no calls added | shield_used_on matches yesterday | shieldNotice and streak tests |
| Lapse | COPY_BANK / revealRows | Silence, blame | Is my record lost? | Record remains; a new streak can begin | Existing lapse predicates | copy-select / revealRows tests |
| Pending result | revealRows / pendingLine, ledgerLines | Counted shortly; noon | Is this settled? | Verification pending; streak updates at settlement | Existing pending/settled data | revealRows tests |
| Reveal/rank UI | reveal route (other owner) | Mixed score and rank terminology | Whom did I beat? | Oracle outcome plus daily board; versioned eligibility | Server result/field size | Reveal owner |
| Live receipt | round route (other owner) | Generic crowd suspense | What am I waiting for? | Only supported crowd disagreement; no settlement guarantee | Submitted question + crowd floor | Round owner |
| Confidence history | ConfidenceHistory | Competitive Oracle Score | What does my record show? | Forecast rating; incomplete-round history and corrections retained | Resolved calls, existing threshold | Typecheck |
| Share identity | ShareCard | ORACLE | What game produced this? | OUTSEE; Oracle comparison retained | Existing share payload | Source review; no scoring changes |
| Plaque share | PlaqueShareCard (scope extended) | Forecaster ledger, VIGIL, CONVICTION | Whose record? | OUTSEE · YOUR LEDGER; STREAK; CONFIDENCE; separate player and Oracle ratings | Ledger share | Source review; native fit remains |
| Text share | sharePattern / shareMessage | 🔮 ORACLE | What game is this? | 🔮 OUTSEE; points, result marks, link retained | Existing share payload | sharePattern tests |
| Crowd footer | CrowdReveal (scope extended) | N ORACLES HAVE SPOKEN | How many people answered? | UP TO N PLAYERS PER SHOWN QUESTION | Existing crowd floor; maximum per-question count, not distinct round participants | Source review; sparse floor retained |
| Plus creed | COPY_BANK paywall / plus | Multiplier substitution; protected by subscription | What does payment buy? | Optional eligible streak protection; no calls/wins/points; available reserve required | Min streak 3; monthly free shield; +3 paid per billing period, grant cap 5 | Core tests; webhook constants inspected |
| Plus active | PUSH_CAMPAIGN_LINES / plus | Your vigil is protected | Am I protected now? | Active; protection depends on streak and reserve | Subscription-active state only | Core copy-select test |
| Plus billing | plus / PriceRow | ONE MOON / TWELVE MOONS | What is the period and price? | MONTH / YEAR, store price untouched | Existing offerings | Typecheck; purchase IDs unchanged |
| Purchase failure | plus | Nothing was charged | Was purchase confirmed? | Not confirmed; check App Store purchases | Existing boolean purchase failure (also cancellation) | Source review; no invented charge status |
| Restore | plus | Silent completion | Did restore succeed? | Request finished; status above; check App Store if unchanged | Wrapper returns no result/error status | Limitation: cannot distinguish failure from no entitlement without monetization-owner change |
| Permission explanation | SUMMONS_LINES / summons | Once to ask, once to answer | Why allow notifications? | Optional reminders, up to two/day; ALLOW REMINDERS | Existing permission policy | Core lint; typecheck |
| Local reminders | reminders / schedule | Future rounds, results, noon, crowd asserted | Why return? | Neutral Outsee invitation; check predictions/next challenge | Existing seven-day schedule and sealed-count gates | Multi-date reminder regression |
| Server push | compose / COPY_BANK noon | Unsupported generic settlement/social claims | Is my result ready? | Result-ready copy requires actual scored personal call | Settled audience + non-void outcome + non-null points | compose tests including all-void suppression |
| Site landing | public/index.html | OUTSEEN; one a day; next-day result; database guarantee | Why play? | Promise, both opponents, timing, record, optional protection | Public explanation; TestFlight status retained | HTML source review |
| Support | public/support.html | Guaranteed 24h; shields without floor | Why closed; why streak broke? | Individual deadlines; streak floor/reserve; no increment | General support; contact route preserved | HTML source review |
| Privacy | public/privacy.html | OUTSEEN | Which product is this policy for? | Outsee only | Policy content otherwise retained | Diff review |

## External configuration and cross-owner handoff

No dashboards, campaigns, stores, domains or live services were changed. OneSignal dashboard display name/campaigns and store listing identity require a separately authorized publish. API `push/onesignal.ts` supplies no heading, so remote sender identity depends on application/dashboard configuration; local scheduled sender is Outsee.

Core index owner exports `gameCopy.ts`. Home owner owns `index.tsx`, `homeLines`, OracleClock and arrival helpers. Round/reveal/practice owners own their orientation, entry measurement, historical-reference links and board explanations. `config/links.ts` destinations were inspected and retained. Integration controller should review every remaining identity search match by the four classifications above, rather than globally replacing Oracle.

Native small-screen, Dynamic Type, VoiceOver and skip/continue layout checks remain part of the controller's device acceptance. Source and pure tests cannot establish visual fit or novice enjoyment.

## Verified board-count correction

The API's `field_size`, `your_rank` and `BOARD_MIN_FIELD` count human players only. The Oracle is appended and ranked among humans for comparison without increasing the field count. Current Build your record copy therefore says “eligible players; the Oracle is also shown for comparison.” Scoring and eligibility are unchanged. The controller owns the corresponding plan/spec correction; the board owner coordinates its presentation.

## Follow-up creative and incentive pass

See `outsee-creative-gameplay-pass.md` for the September 8 end-to-end refinement, including result explanations, optional streak motivation, explicit AI disclosure, scoring asymmetry and the distinction between maximizing points and winning a round. It supersedes earlier exact-wording examples while preserving the mechanics.
