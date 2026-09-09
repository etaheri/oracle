# Question quality review

Review the next 15 real candidates before publication. No real candidate sample was available for this local implementation, so this review remains pending. Unit-test questions and the local simulator fixture are synthetic and are not editorial evidence.

Score each dimension 0–2: 0 means replace, 1 means revise, 2 means ready.

| Dimension | A ready question |
|---|---|
| Understandability | A newcomer can restate the yes/no outcome without specialist vocabulary. |
| Reasonability | A newcomer can name plausible reasons for either side. Neutral context explains unfamiliar facts. |
| Interest | Someone wants to learn the outcome; uncertainty alone is insufficient. |
| Resolution | One named primary source and a precise measurement decide the answer. |
| Fair window | No part of the answer is available before the common lock. |
| Fast resolution | At most one question resolves after the evening of the lock, and that one is the Big One. Nothing resolves after noon ET two days out. |
| Forecast-grounded | A weather line sits where tonight's public forecast is genuinely uncertain, not at a number it already clears. |

The implemented editorial gate excludes a zero in understandability, reasonability, or interest after the integrity checks. It prefers an accessible opener and a nominated Big One. It cannot rescue an integrity rejection. Optional context requires an independent verification verdict and a timestamp before review and publication; automated approval is not a substitute for human source review.

For each candidate record: text, category, source, earliest possible answer time, scores, opener/Big One suitability, context/source/timestamp, keep/revise/replace, and rationale. Review the final five as a set for variety and familiarity.

Context must contain neutral facts only, at most 240 characters. Exclude recommendations, odds, crowd or Oracle probabilities, and anything revealing the answer. Verify the cited primary source yourself. If uncertain, omit context.

After three consecutive real rounds, record voids, early closures, time from lock to resolution, and any disputed evidence. Review late or voided questions individually. A version 2 early closure is a global void, never a late-player advantage.

Completion evidence: pending real candidates and completed live rounds.
