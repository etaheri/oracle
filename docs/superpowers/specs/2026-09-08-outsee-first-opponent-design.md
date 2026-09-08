# Outsee: meet your opponent

## Intent

Outsee is the app and daily prediction game. The Oracle is its AI opponent. Players compete against both the Oracle and each other on the daily board; their aggregate predictions are the crowd. The first session should establish those roles, let the player make an interesting judgment, and deliver either a live commitment or a complete unranked exhibition with an immediate result.

This records the direction accepted in the September 8 conversation. The accompanying implementation plan makes routine implementation choices concrete; no gameplay code has been changed.

## Experience

Keep the existing orb, museum-white ground, gold emphasis, restrained type, tactile sealing, and terminal transitions. Put Outsee in the app identity and label the orb “THE ORACLE” with “Your AI opponent.” Operational explanations use plain language. The Oracle's personality appears in invitations and earned reactions. Do not call players oracles.

First home: “Can you see something it doesn't?” with “Five questions about what happens next. Your judgment against the Oracle—and everyone else.” Primary action is “MAKE YOUR FIRST CALL” when live questions are available; otherwise “CHALLENGE THE ORACLE,” explicitly labeled an unranked exhibition. Returning players receive current-round information without repeating the introduction.

Replace the long first-launch lore sequence with a short, visibly skippable introduction: “OUTSEE” / “MEET THE ORACLE” / “YOUR AI OPPONENT.” Essential information also lives on static home; reduced motion and skipping lose no instructions. Target at most four seconds total. Returning boot identifies Outsee and remains skippable. Do not replay onboarding to existing players or put it over deep links.

The first-round introduction explains answer, confidence, and later comparison in three short statements. Optional exhibition is available here, without forcing live players through another tutorial. Use “TRY AN EXHIBITION” and supporting “One practice question. Immediate result. Unranked.” Keep “seal your call” and “ledger” where their meaning is evident; use “HOW TO PLAY” for rules navigation.

## Exhibition

Reuse the practice route and card interaction. Prefer one settled historical question with its original pre-outcome context, real recorded Oracle probability, and outcome. Select deterministically from eligible recent history without inspecting the user's answer or optimizing for an Oracle loss. Only use fully settled rounds, non-void outcomes, valid probabilities, and usable context. Show “PAST ROUND · UNRANKED”; context is explicitly from before the event. Historical knowledge is allowed because this is practice.

When history is absent or cannot load, provide a bundled, honestly fictional example: “Will the blue marble be drawn?” Context: “This fictional bag contains 7 blue marbles and 3 amber marbles. One will be drawn.” Fixed example Oracle probability: 0.70; fixed example result: yes. Both are labeled fictional when revealed. Neither changes in response to the player's choice. Do not imply a real Oracle forecast or real random draw occurred.

Sequence: context → answer/confidence → sealed receipt → reveal Oracle forecast and outcome → points comparison → context-aware next action. Keep forecast and outcome out of visible UI and accessibility text until reveal; local fixture contents need not be secret. Score both sides with oracleQuestionPoints, without bonuses; a single question is an exhibition, never a rated daily duel. Missing data never becomes an invented historical forecast.

After reveal, offer the available live round, remaining questions, or return home with the next opening time. Re-evaluate availability at press time. Retrying explicitly reuses the same example and known outcome. Exhibition does not submit predictions, update score/streak, earn live milestones, or trigger notification permission.

## Arrival states

| State | Message and action |
| --- | --- |
| Loading / answer hydration | Neutral loading; do not flash missed-day or first-call claims. |
| Fetch failed | “Couldn't load today's round.” Retry plus exhibition; do not say Oracle sleeps. |
| All required questions available | Invite first call or play today, show next question deadline in device-local time. |
| Some required questions missed, some open | Lead with remaining count and action. Explain that calls can still receive results but competitive round eligibility may be lost. |
| All required calls submitted | Crowd comparison and pending results. |
| No answerable questions | Exhibition and scheduled next opening if known. |
| No schedule | Exhibition; “The next round hasn't been announced.” No fabricated countdown. |
| Personal result ready | Prominent result access; keep live play reachable. A spectator's yesterday is secondary on first arrival. |

An early-closed question voided for everyone is not a player miss. Version 1 and version 2 rating rules stay unchanged. Before settlement, avoid categorical “cannot rate” when a currently missed question could later void: use “A competitive result requires every non-void question. You can still see results for the calls you make.” Definitive ineligibility copy is reserved for known settled facts. Do not treat three answered questions alone as sufficient.

## Anticipation and payoff

Live Oracle forecasts stay hidden until existing reveal rules allow them. After sealing, summarize available crowd disagreements only for submitted questions and crowds meeting existing display thresholds. Say “The crowd currently leans the other way on 2 of your calls”; crowd membership can change, so do not imply a frozen comparison. Ties, tiny crowds, and absent data produce neutral anticipation.

Keep existing overall duel headlines and score calculation. Add an evidence-based explanation of a notable points gap: opposite calls, confidence difference on the same answer, or Oracle abstention. Identify it as the largest gap, not the decisive cause unless that causal claim is computed. Never describe a question win as a round win. Pending, incomplete, insufficient and unavailable duels retain honest fallbacks. Present the personal Oracle duel and existing daily board together near the top of results. The board is a core payoff, not a buried reference. Keep evidence accessible.

## Constraints and success

Use Outsee as requested; current OUTSEEN site spelling is corrected. Preserve internal package names, bundle identifiers, URL schemes, persistence keys, backend identifiers and purchase product IDs. Rename user-facing Plus to Outsee Plus; use Your forecast rating for the player and Oracle rating for the opponent, preserving scoring and API identifiers. No new scoring, payment, notification, friend challenge, or leaderboard system.

Verify new users can explain app/opponent/crowd, choose an action after missing timing, and explain confidence after the exhibition. Measure exhibition completion, first live seal, and first eligible result return by arrival state. Instrumentation does not prove improvement; validate with novice playtests before claiming success.


## App-wide purpose and copy system (September 8 follow-up)

The copy must answer why the game is worth playing, not merely define its mechanics. Use one motivation hierarchy across landing, introduction, rules, play, results, ledger, notifications and Plus:

1. Today's challenge: can you outsee the Oracle and outscore other players on the daily board?
2. The lasting reward: a record of what you believed before the answer was known, showing where your confidence fits the outcomes and where it does not.
3. The optional ritual: returning regularly to make another call. A streak recognizes participation; it is not proof of skill, improvement or a winning streak.

Canonical promise: “Make your call. Outsee the Oracle. Outscore the field.” Supporting explanation: “Predict real events, choose your confidence, and compete against the Oracle and other players. Return for the results to see who scored higher.” Never guarantee that repeated play improves forecasting ability; the record gives players feedback with which to learn.

### Vocabulary and voice

| Concept | Main label | Explanation / use |
| --- | --- | --- |
| App | Outsee | Product identity, purchases, notification sender |
| Opponent | The Oracle | Your AI opponent; neither host authority on outcomes nor name for other players |
| People | Players / the crowd | Individual competitors / aggregate predictions |
| Prediction | Call | First use: “Your prediction is a call.” |
| Commitment | Seal your call | Explain that submission locks answer and confidence |
| Probability | Confidence | “Conviction” may appear in flavor, not as a second unexplained control label |
| Rules | How to play | Page title “The Rites” with visible subtitle “How to play”; preserve the brand while making navigation clear |
| History | Your ledger | Subtitle “Your predictions and results” |
| Participation | Streak | Detail title “Your vigil” with explicit streak explanation; use Streak in primary stat labels |
| Skill rating | Your forecast rating | Rename user-facing player ORACLE SCORE to YOUR FORECAST RATING; the opponent's corresponding label is ORACLE RATING. Preserve oracle_score fields and calculation. These labels distinguish whose rating is shown. |
| Paid continuity | Shield | Protects an eligible streak through a missed round; does not add predictions or a win |

Use atmosphere for headings and earned reactions; plain language for rules, dates, eligibility, errors and purchases. Avoid multiple synonyms in one instruction. No need for every screen to restate the entire promise: each should explain its place in the same loop.

### The Rites page

Lead with “Make your call. Outsee the Oracle. Outscore the field.” Organize the full reference into short sections, with the essential three-step introduction still separate:

- The challenge: five real-world questions, compete against the Oracle and other players, and see your place on the daily board. The crowd is the aggregate of player predictions, not a separate ranked opponent.
- Make a call: yes/no, confidence, irreversible sealing, crowd hidden until commitment, Oracle forecast hidden until reveal.
- Face the result: right answers and confidence determine points; Big One weight; equal base-point duel comparison; crowd bounty separately identified.
- Build your record: daily duel versus long-term rating versus confidence history. Explain the fifty eligible calls threshold without requiring consecutive days. Current complete-round/non-void/minimum-resolution rules are stated once in detail.
- Keep a vigil: optional participation streak, its actual qualifying action, shield protection and recovery after a gap.
- Timing and fairness: actual deadlines, voids, unresolved outcomes and incomplete rounds. Link to context-specific historical rules when viewing old rounds instead of mixing legacy multipliers into current instructions.

### Streak meaning and factual copy

Observed implementation: at least one submitted prediction in a daily round qualifies participation, even if the round is incomplete; the streak is updated during settlement. A shield can preserve the count across a missed round without incrementing it. Current rules do not multiply points by streak. Therefore, do not label a protected streak “consecutive days played” or imply it proves daily practice with no gaps.

Suggested detail: “Your vigil is your playing streak. Seal at least one call in a daily round to keep it going; the count updates when that round settles. It marks your return, not your accuracy. Shields can protect it through a missed round.”

Primary stat: “STREAK · 7 DAYS,” with protection explained in the detail. After a shield: “Your shield preserved your streak. No calls were added.” After a lapse: “A new streak begins with your next call. Your predictions, results and rating remain.” Before settlement: “Today's call is sealed. Your streak updates when the round settles.” None of these imply a rating requires a streak.

Streak is secondary to the Oracle challenge and the forecasting record. A player who does not care about attendance still has the full reason to play. The record and existing milestones carry recognition; this pass does not invent streak rewards, unlocks or benefits the game does not provide.

### Plus and reminders

Explain Plus as optional continuity protection: “Keep a streak you care about through an eligible missed round. Shields protect the streak, not your score.” State the actual eligibility, grants and reserve limits using current constants/entitlements. Do not promise guaranteed protection solely because a subscription is active. Free play and all competitive opportunities remain clear. Use month/year billing labels with readable terms; “moons” can be secondary flavor, never the sole billing period.

A reminder invites the next worthwhile action. A scheduled local notification cannot know a future round exists, a result is ready, a crowd has formed or a streak will break. Use neutral “Return to Outsee to check your next challenge” when those facts are unverified. Server-confirmed results can say “Your result is ready. See how you compared with the Oracle.” Retire threats, fictional crowd activity and categorical settlement claims from generic copy pools. Keep notification frequency and permissions unchanged.

The appeal of purchasing streak protection may remain limited for players who do not value streaks. That is a product tradeoff, not something to conceal with grander wording or an invented score advantage.

### Consistency acceptance

Every applicable screen has a defined purpose, canonical terms and copy tied to actual state. Current and archived rules must not silently share contradictory copy. Shared source strings, local overrides, push composition, scheduled notifications, share cards and site/support text are all in scope. Externally configured dashboard copy is inventoried for a later authorized publish, not silently updated.

A novice should be able to explain: why play today; why return for results; what the long-term record tells them; what preserves a streak; why streak is separate from skill; what remains after missing a day; and what a shield actually buys.


## Competition visibility and board truth

The product has two explicit competitive payoffs: your result against the Oracle and your placing in the daily field. First home, first-round introduction, full Rites and site must name both. An exhibition teaches the Oracle comparison only; explain that the daily round also puts the player on the board against other people, subject to eligibility. Do not imply exhibitions rank against real players.

Use “DAILY BOARD” for rankings and “THE CROWD” for aggregate prediction percentages. A majority percentage is not a rank and going against the majority is not itself a victory. The long-term forecast rating is a third, separate measure of forecasting performance; its fifty-call threshold does not gate the first eligible daily placing.

Use actual API ranks, field sizes, tie behavior and minimum-field rules. The board displays the Oracle when eligible, but field_size, your_rank and the minimum-field threshold describe human players. Label placing as rank among players, with the Oracle shown for comparison; do not add the Oracle to the denominator or re-rank. Retain the server's truthful sparse-field state. Do not invent opponents, social activity, rankings for incomplete rounds or direct friend challenges.

On results, pair the Oracle outcome with “Your place on the daily board” when available, and an adjacent VIEW DAILY BOARD action. When rank is withheld, explain the reason in plain language without hiding the personal result. On partial/void historical rounds, use version-aware eligibility explanations rather than the present hardcoded “all five.”

Acceptance: a novice should say “I'm trying to beat the Oracle and other players,” find both result comparisons, and distinguish their rank from crowd opinion and their streak. No new leaderboard backend is needed.


## Experience acceptance: new and existing players

Understanding must survive skipping onboarding, upgrading from Oracle branding, returning after a gap, or entering via a result link. Essential orientation belongs in ordinary screens, not solely a one-time introduction. Existing players get the same clear app/opponent identity, competition explanation and reference access without resetting flags or forcing a tutorial.

| Player question | Required answer | Where it is evident |
| --- | --- | --- |
| What is this? | Outsee is a daily prediction game about real events. | Static home descriptor, site, How to play |
| Who am I competing against? | The Oracle, an AI forecaster, and other players on the daily board. | Home supporting line, introduction, Rites, results |
| What do I do now? | Choose an available question, answer yes/no and set confidence; if live play is closed, try an unranked exhibition. | State-aware main action and card guidance |
| What is the point? | Try to score higher by making better judgments, then see how your predictions held up. | Home promise, confidence feedback, Oracle result and placing |
| Where is the fun? | Make a judgment you care about, commit, discover disagreement, anticipate the outcome, then experience a win, surprise or useful correction. | Question context, tactile seal, crowd comparison, reveal highlight |
| Why return? | Find out what happened, see whom you outscored, and take on the next challenge. | Sealed receipt, waiting home, result-to-next-round action |
| Why keep playing over time? | Build a record of your forecasts and learn where your confidence matches reality. | Ledger and confidence history, independent of streak |
| Why keep a streak? | Personal recognition for returning, if that matters to you; no competitive advantage. | Streak detail, lapse copy, Plus |
| What if I missed something? | A clear remaining action and next known opening; past predictions, results and rating remain. | Partial/closed/lapsed states |

Persistent home orientation is compact: “A daily prediction game” and “Compete against the Oracle and other players.” Place these with the identity/challenge block for both cohorts; state-specific timing and actions remain more prominent. Do not replay a tutorial for existing users, and do not rely on a temporary rebrand announcement to carry this information. Keep How to play reachable from home and the ledger; deep-linked results label Outsee and both comparison types without an onboarding overlay.

Each main screen must supply a relevant action, enough explanation to choose it, and the payoff or next step. This is progressive explanation, not the whole rulebook repeated on every screen. Atmosphere never replaces the instruction.

The fun requirement is experiential: exhibition and live question context must give the player some basis for judgment; the reveal must explain a meaningful comparison rather than only increment counters. During playtests ask which moment made them curious, what they are waiting to discover and what would bring them back. Record boredom/confusion as findings even when comprehension checks pass. A plan or copy audit cannot prove the game is enjoyable.
