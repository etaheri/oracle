# Outsee: creative copy and incentive review

September 8, 2026. Follow-up to the first-opponent implementation. This is a source-level review of the whole player journey plus a limited native copy-fit check, not a claim of measured enjoyment.

## Editorial decision

“Your AI opponent” is accurate but generic. It categorizes the technology where the player needs a challenge. Home now reads **THE ORACLE · CAN YOU OUTSEE IT?** First contact reads **OUTSEE / MEET THE ORACLE / IT MAKES A CALL. SO DO YOU.** How to play and the website plainly disclose that the Oracle makes predictions using AI. The home still names competition against other players.

Voice: a restrained rival, with a readable rulebook. Keep Outsee, Oracle, call, seal, ledger and vigil. Use ordinary language for actions, errors, purchases and explanations. Do not make every sentence sound like an inscription. Preserve the existing orb, materials, typography and motion; this pass does not redesign them.

## End-to-end decisions

| Moment | Player's reason to act | Change / decision |
| --- | --- | --- |
| First contact | Test my judgment against a rival | Replace the AI category label with a challenge; explain the technology in the reference |
| Home / live | Take a view on what happens next | Keep both competitions explicit; ask “How sure are you?” |
| First call | Understand the consequence before committing | Intro names yes/no, confidence, upside and downside, then seal and return |
| Late arrival | Have a useful turn now | Lead with remaining questions and points, or an immediate unranked example; preserve eligibility warning |
| Exhibition | Experience a decision and payoff quickly | Shorter sealed receipt and result headlines; fictional provenance stays visible; no manufactured live victory |
| Exhibition replay | Understand how confidence changes the score | Rename retry to EXPLORE THE SCORING and explicitly say the outcome is known; replay is exploration, not evidence of skill |
| Waiting for results | Find out whether my view held up | Crowd is social context after committing; no advance Oracle reveal or unsupported result-time promise |
| Result | Understand why I won or lost | Same-answer explanations now distinguish higher/lower confidence and right/wrong outcomes; tied points never invent a gap |
| Daily board | Compare with other players | Keep player ranks separate from the Oracle comparison; base points use the same formula |
| Ledger | See whether judgment holds up over time | Rating is cumulative performance; history is useful before the rating threshold |
| Streak | Keep a personal daily ritual | One daily call, no point advantage, preserved records after a gap; avoid selling attendance as accuracy |
| Plus | Choose optional streak protection | Explicit JOIN OUTSEE PLUS / RESTORE PURCHASES; retain actual grant limits and renewal terms |
| Reminders | Reopen a question or see what happened | Replace generic system descriptions with grounded curiosity; ready-result copy remains evidence-gated |
| Sharing / errors | Finish a clear action | SHARE YOUR RESULT, PREPARING, and a direct retry error replace prophecy/conjuring language |
| Website / support / privacy | Recognize the same product and mechanics | Landing page aligned with challenge, late arrival and streak purpose; support and privacy reviewed, existing factual terms retained |

## Incentives: findings from the implementation

1. **Confidence is the meaningful choice.** Before rounding, base points are `200 × (0.25 − (p − outcome)²)`, doubled for the Big One. For a belief `q`, expected base points subtract `(p−q)²`; matching belief maximizes that expectation over available reports. The player grid and integer rounding constrain that ideal. The copy therefore invites a confidence the player can stand behind, rather than urging maximum confidence.
2. **A leaderboard win is a different objective from expected points.** Maximizing the chance of beating a rival in one round can favor risk, depending on the score distribution. The app should not promise that conservative or honest confidence guarantees a win. Daily competition supplies tension; a cumulative rating supplies a longer-term perspective.
3. **The crowd bounty can change the preferred side.** It is independent of confidence within a chosen side, but paid only on a correct minority call. At a 51% belief in YES, 55%-confidence YES earns 0.2 expected rounded base points. If NO qualifies for the 20-point bounty, 55%-confidence NO earns 9.6 expected day points. This is an intentional side incentive, not a globally proper forecast score. Bounties are excluded from duel/board/rating. Corrected misleading code comments; scoring itself is unchanged.
4. **Same formula does not mean identical options.** Players choose 55%–95% confidence and must choose a side. The Oracle may use the full probability range and abstain at 50%. Replaced “same rules for both” with “same scoring formula”; the reference now spells out the difference.
5. **An exhibition cannot prove skill once the answer is known.** Fixed replay is useful for understanding points, not an achievement. Historical and fictional labels, fixed outcomes, lack of live rewards and counterfactual loss examples remain.
6. **Streaks have no competitive benefit under current rules.** Their value is an optional ritual. Buying a shield protects that ritual, not rank or skill. Copy cannot invent a deeper reward that the game does not have. This is also a product question for playtesting: do players value the ritual enough to care about protection?
7. **The first payoff must precede 50 qualifying calls.** Immediate exhibitions, daily Oracle results and eligible player boards serve that purpose. Sparse fields still need enough eligible players to show ranks; no fabricated social proof or guaranteed placing was added.

## What to test with players next

Ask unfamiliar players to make one call, explain what confidence changes, identify the Oracle and the other-player competition, and explain why they would return. Ask whether the Oracle reveal or their place among players matters more. For existing players, test whether a streak feels like a chosen ritual or an obligation. Observe behavior before explaining the intention.

Do not add currency, streak multipliers, forced tutorials, arbitrary achievements or paid competitive advantages to solve a copy problem. If players understand everything but do not care about the outcomes, the next experiment should focus on question selection and meaningful rivalry, not louder wording.

## Validation

- Core suite: 162 tests passed. Mobile suite: 369 tests passed. API push composer: 11 tests passed.
- Workspace typecheck passed; iOS export passed for the editorial changes.
- Added meaningful result cases for equal-point exhibitions, both-wrong confidence comparisons, and NO-side confidence. Existing scoring/eligibility tests remain intact; runtime scoring was not changed.
- iPhone 17 Pro / iOS 26.5 local fixture: inspected the revised home challenge in its existing layout, then used the hold-button alternative to seal and reveal an exhibition. Verified the shorter result headline, fictional provenance, counterfactual loss and EXPLORE THE SCORING action.
- No new claim of full-device accessibility validation, novice comprehension, retention or enjoyment. The prior validation report's device and participant limits still apply. No external services or store copy were published.
