# Outsee first-opponent implementation validation

Implementation workspace: `/private/tmp/outsee-first-opponent`, branch `codex/outsee-first-opponent`, starting at `37aaf1d`.

## Baseline and environment

- Baseline `pnpm test`: 1,019 passed (149 core, 542 API, 328 mobile).
- Baseline API suite takes approximately four minutes; its quiet output is normal.
- Dependency setup refreshed the pre-existing missing site importer in pnpm-lock.yaml. Declared package versions were not changed.
- Existing mobile Vite config warning is unrelated to these changes.
- Expo 57 documentation required by apps/mobile/AGENTS.md was read before implementation.
- Interactive validation uses an in-memory local fixture API at `127.0.0.1:8799` and the isolated Metro server at port 8097, with no production API or optional SDK credentials. Synthetic questions and records are labeled LOCAL FIXTURE.

## Verification record

Implementation, final tests, review and simulator observations are recorded below as they complete. An unrecorded case is not claimed as passed.

## Acceptance mapping

| Question | Implementation evidence to inspect |
| --- | --- |
| What is Outsee? | Persistent home identity and daily prediction descriptor; site |
| Who am I competing against? | Home and Rites name Oracle and other players; results show duel and daily board |
| What can I do now? | Arrival selector covers loading/error/live/partial/submitted/waiting; practice exit refreshes availability |
| What is the point? | Purpose statement, confidence feedback and actual points comparisons |
| Where is the fun? | Context before call, tactile seal, current crowd disagreement, Oracle reveal and board |
| Why return? | Pending receipt and next-round/action copy |
| Why keep playing? | Forecast rating and confidence history explain cumulative performance |
| What is a streak for? | Ledger/Rites/Plus separate participation from accuracy and protection from points |
| What if I missed timing? | Remaining calls or exhibition, known next opening, preserved record |

## Human validation boundary

Unfamiliar-player and returning-player interviews require actual participants. No human playtest, enjoyment improvement or retention lift will be claimed from automated tests or simulator inspection. The five-person protocol in the implementation plan remains the follow-up for assessing comprehension and appeal with real players.

### Integrated automated checks (before final review fixes)

- `pnpm test`: passed, 1,071 tests (162 core, 550 API, 359 mobile).
- `pnpm typecheck`: passed for core, API and mobile.
- `EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:8799 pnpm --filter @oracle/mobile exec expo export --platform ios --output-dir /private/tmp/outsee-ios-export`: passed, Hermes iOS bundle emitted.
- Task 3 independent spec/quality review: passed. The copy review requested one site wording correction; corrected to human-player rank with Oracle shown for comparison.
- Integrated UI review found four actionable issues (offline exhibition entry, stale home navigation, stale practice exit, Oracle NO confidence label); fixes and covering checks are recorded below once complete.
- Simulator connection initially failed because `--localhost` bound Metro to IPv6 while advertising an IPv4 bundle URL. Restarting with `NODE_OPTIONS=--dns-result-order=ipv4first` fixed the local validation connection; no app/network policy change was required.

### Remediation and native walkthrough

- Fresh mobile suite after home/practice remediation: 364 tests across 48 files passed. Workspace typecheck passed. Combined with unchanged core/API suites, 1,076 tests have passed across the implemented areas.
- Fresh iOS export passed to `/private/tmp/outsee-ios-export-final` after those fixes.
- Independent final source review confirmed all four earlier UI findings and the site correction. It found the same callback-lifetime issue in Rites BEGIN; its final disposition is recorded below.
- iPhone 17 Pro / iOS 26.5, existing installed development build, local synthetic API: waiting home visibly showed OUTSEE, THE ORACLE · YOUR AI OPPONENT, daily prediction descriptor, both competitors, local next opening and exhibition action.
- Exhibition: chose YES through the accessibility hold-button alternative. Sealed receipt showed only YES/55%; explicit reveal then displayed fictional YES outcome, example Oracle YES/70%, +10 versus +32 base points and confidence-gap explanation. One RETURN HOME action remained. No live prediction was submitted.
- How to play: inspected readable purpose-first Rites with competition, confidence, record, streak and timing sections in the accessibility tree; the top portion rendered without clipping at the current text size.
- Partial fixture: home showed two questions remaining and honest competitive-eligibility guidance. ANSWER REMAINING QUESTIONS opened question IV; the first three were marked closed.
- Existing-player settled fixture: home exposed a personal-result action and a seven-day participation streak explanation. Reveal showed the Oracle duel, largest-gap explanation and player-rank summary. VIEW DAILY BOARD expanded and scrolled directly to rows with explicit Oracle-as-comparison wording.
- These are synthetic layout/interaction checks. Fixture board/day totals were independently supplied and are not scoring verification; shared scoring is covered by automated tests.

### Remaining validation limits

- No new native binary was installed: app.json now names Outsee, while the already-installed development launcher may retain its previous native name. iOS bundle export passed; release archive/signing was not run.
- The existing simulator record/Keychain was preserved. A clean first-install walkthrough was not claimed.
- CUA accessibility inspection and button activation succeeded; coordinate/scroll operations returned `noWindowsAvailable`. This prevented completing the manual scrolling/gesture/device-accessibility matrix. Large-text, smaller-screen, reduced-motion and spoken VoiceOver walkthroughs remain unchecked. No system settings or user records were reset to simulate them.
- Remaining edge cases such as hydration, deadlines, missing schedules, neutral Oracle and invalid history have automated coverage; automated coverage is not represented as a native walkthrough of every combination.
- No production API, deployment, store purchase, push delivery, real participant interview or retention measurement was performed.

### Final checks after Rites remediation

- `pnpm --filter @oracle/mobile test`: PASS, 366 tests / 48 files.
- `pnpm typecheck`: PASS, core, API and mobile.
- `EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:8799 pnpm --filter @oracle/mobile exec expo export --platform ios --output-dir /private/tmp/outsee-ios-export-complete`: PASS.
- Total passing automated coverage: **1,078 tests** (162 core + 550 API in the integrated run, followed by 366 mobile on the final mobile tree). Core/API were unchanged by the final navigation fixes and were not unnecessarily rerun.
- Service-error native fixture showed RETRY and TRY AN EXHIBITION. Exhibition opened immediately, rendered the bundled fictional example and returned home; live-service failure did not gate the fallback.
- Rites BEGIN now invalidates its pending action on alternative navigation and blur, checks ownership after each await and in failure handling, and permits a fresh attempt after return. Focused guard tests cover stale success/rejection and a newer attempt.

- Final scoped independent review: **PASS, no open findings**. The Rites callback-lifetime correction is addressed; native/accessibility and human-playtest limits above remain separate.
