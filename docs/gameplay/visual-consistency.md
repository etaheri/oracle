# Mobile visual consistency

The existing palette, fonts, ASCII effects, and Home composition remain the foundation.

## Typography

Use the shared `role` props from `ui/Text.tsx`:
- `eyebrow`: page and section stamps, 10/14 with 4pt tracking.
- `meta`: compact state labels, 10/14 with 2pt tracking.
- `line`: short machine speech and navigation, 11/16 with 2pt tracking.
- `caption`: secondary reading text, 10/16 with 1pt tracking.
- `supporting`: explanations and evidence, 11/18 with 0.5pt tracking.
- `body`: extended reading, 12/20 with 0.5pt tracking.
- `action`: framed buttons, 12/18 with 3pt tracking, centered even when wrapped.

When overriding alignment, retain the role's line height by composing its style in an array. Serif and carved numerals retain their existing sizes; shared primitives now supply predictable line heights unless the component explicitly overrides them. Gameplay questions retain their 22/32 treatment.

## Spacing and alignment

Use the 4pt spacing scale: 8pt within related groups, 12pt between related controls, 16pt between sections. Page gutters remain 20pt or the safe inset, whichever is greater. Dense receipt groups use 8pt rather than fractional gaps. Framed artifacts may retain 20–24pt internal margins where their construction requires them.

Keep labels left aligned and ledger values right aligned, allowing both to wrap. Center standalone results and actions. Modal routes own a local SafeAreaProvider so the full-screen notch inset is not repeated inside the sheet. Screen owns fixed header/footer safe padding.

## Verification — 2026-09-06

Reviewed all route sources and shared text/control components. Native iPhone 17 Pro / iOS 26.5 inspections: Home, daily result, Ledger, Plus. Plus also checked at maximum Dynamic Type; original `large` setting restored. Tests: 317 passed; mobile typecheck and iOS export passed.

Not an exhaustive device matrix: small phones, Android, and every data-dependent screen state still need broader visual QA. No changes to scoring, font families, base question size, ASCII effects, or Home motion.
