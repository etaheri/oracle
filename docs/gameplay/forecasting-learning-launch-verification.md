# Forecasting learning launch verification — September 7, 2026

Implemented the two launch features on `codex/forecasting-learning`:

- Ledger confidence history uses equal-weight lifetime resolved calls, exact confidence levels, factual counts, and a 20-call-per-level display threshold. It replaces the ledger calibration verdict without changing Oracle Score.
- Reveal highlights explain actual base points and Big One weight. Optional resolution excerpts retain their own validated HTTP(S) URL and remain separate from the question source.
- Added optional API fields for older-client/server compatibility and minimal existing-provider analytics for viewing/expanding the features.

Validation on the completed implementation:

- `pnpm test`: 987 passed (149 core, 510 API, 328 mobile).
- `pnpm typecheck`: all three packages passed.
- `pnpm --filter @oracle/mobile exec expo export --platform ios --output-dir /private/tmp/oracle-learning-ios-export`: passed.
- Independent static review found no substantive correctness/regression issues.
- iPhone 17 Pro / iOS 26.5 simulator: rendered confidence-ready and building states; expanded confidence details and reveal evidence using accessibility actions; checked spoken percentage/count labels and expanded state in the accessibility tree.
- Maximum accessibility text size: heading and receipt wrap without horizontal clipping in the inspected viewport. Automated scrolling did not move the simulator reliably, so full large-text traversal is NOT verified. Restored original `large` setting.

Screenshots under `docs/gameplay/forecasting-learning/` are explicitly labeled LOCAL FIXTURE, not live records. A temporary local route rendered the production components with synthetic data and was removed before delivery. The fixture did not create users, predictions, or persisted records. Links use example.com and no external source was opened.

Remaining release checks: five-player formative playtest, full small-device and large-text scrolling, and an actual VoiceOver traversal. Accessibility-tree inspection is not a substitute for that traversal. No deployment, partner outreach, seasonal competition, or skill certification was added.

API must be deployed before the mobile build to expose history and paired evidence. An older API hides the history and uses the source fallback rather than fabricating zero counts or pairing an unrelated URL.
