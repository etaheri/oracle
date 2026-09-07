# Mobile layout pass — 2026-09-06

Implemented shared safe-area ownership for fixed headers and footers. Home scrolls when its content exceeds the viewport; practice and summons keep their primary actions outside the scrolling body. Ledger and Plus retain document flow. Rites and completed-round receipts expose scroll indicators. Reveal retains its existing document and fade treatment.

Practice and live gameplay share viewport-constrained card sizing. The question/context region scrolls vertically while the card's existing horizontal pan retains its directional activation threshold. Completed rounds no longer reserve live-game feedback space. Confirmation copy can scroll inside a safe-area-constrained panel while its actions remain outside the scroller. Footer navigation wraps, header labels shrink, and legal links have 44-point targets.

Removed the obsolete current-vigil multiplier from Ledger and its score-weight claim from Plus. Historical scoring is unchanged.

Validation:
- Mobile TypeScript check passed.
- 315 mobile tests passed.
- iOS bundle export passed.
- iPhone 17 Pro / iOS 26.5 simulator: inspected practice card and pinned Return, live round, ledger current-vigil text, and confirmation panel. No deletion or purchase performed.
- Maximum accessibility text size: inspected live card containment and header/footer labels. Fixed stale native label measurement after changing Dynamic Type by remounting capped text on font-scale changes. Restored the original `large` text-size setting.

Limits: synthetic local API data; no small-device simulator run. Automated touch delivery was previously unreliable, so horizontal pull versus vertical question-scroll arbitration still needs a manual interaction check. This pass does not claim that gesture check passed.
