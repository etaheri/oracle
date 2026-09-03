---
name: run-oracle-mobile
description: Build, launch, drive and screenshot the ORACLE iOS app on the Simulator. Use when asked to run, start, open, test, screenshot, or verify a change in the actual app (not the test suite) - including "does this look right on device", the reveal, the ledger plaque, the rites, or the daily board.
---

# Running ORACLE (apps/mobile)

Expo SDK 57 dev-client build on the **iOS Simulator**, talking to a local
Cloudflare Worker (`apps/api`, port 8787) and Metro (port 8081). Everything is
driven by `driver.mjs` — `xcrun simctl` plus a direct Postgres connection.

**macOS only.** This is not a "the README author had a Mac" assumption: the app
runs on the iOS Simulator, which ships with Xcode and does not exist on Linux.

All paths below are relative to `apps/mobile/`.

```
node .claude/skills/run-oracle-mobile/driver.mjs <command>
```

## Prerequisites

- Xcode with an iPhone simulator (any recent one; verified on iPhone 16 / iOS 18.5).
- `apps/api/.dev.vars` with `DATABASE_URL` pointing at the Neon **dev** branch.
  Gitignored — get it from Erik. Without it the API starts but every query 500s.
- `cliclick` (only for the `scroll` command):

```bash
brew install cliclick
```

## Start here

```bash
node .claude/skills/run-oracle-mobile/driver.mjs doctor
```

Prints the simulator udid, whether the app is installed, whether Metro and the
API are up, whether `.dev.vars` exists, and the API's health response. Run this
first, every time — **Metro and wrangler are very often already running** from
another session, and starting a second one is the first thing that goes wrong.

## Run (agent path)

```bash
node .claude/skills/run-oracle-mobile/driver.mjs up
node .claude/skills/run-oracle-mobile/driver.mjs seed
node .claude/skills/run-oracle-mobile/driver.mjs launch
node .claude/skills/run-oracle-mobile/driver.mjs go /reveal/2026-09-02
node .claude/skills/run-oracle-mobile/driver.mjs shot reveal
```

Screenshots and service logs land in `.oracle-run/` at the repo root
(gitignored). **Open the screenshot and look at it** — a blank frame or
`THE ORACLE SLEEPS` means you have not actually reached the app.

| command | what it does |
|---|---|
| `doctor` | simulator, app, ports, `.dev.vars`, API health |
| `up` | start `apps/api` and Metro if they are not already listening |
| `launch` | attach the dev client to Metro, then restart the app cleanly |
| `go <route>` | deep link — `/` `/rites?all=1` `/round` `/ledger` `/plus` `/reveal/<YYYY-MM-DD>` |
| `shot [name]` | screenshot into `.oracle-run/` |
| `scroll [n]` | drag-scroll the frontmost Simulator window |
| `seed [date]` | settled round + field + scored cohort, attached to this device |
| `reset-identity` | wipe the simulator Keychain (see Gotchas) |

### Navigate with `go`, never with taps

`expo-router` serves every screen off the `oracle://` scheme, so `go` is exact
and instant. Pixel taps need the Simulator window's position plus a scale factor
solved from its title-bar height, and they miss often enough to burn a session.
`scroll` is the exception — a drag down the middle of the window needs no
accuracy.

### Most of this app is invisible without data

`seed` is not a convenience. The reveal needs a **settled** round; the daily
board needs a field of complete-round players above `CONSTANTS.BOARD_MIN_FIELD`;
the plaque's standing band needs a cohort above
`CONSTANTS.PERCENTILE_MIN_COHORT`. A fresh dev database has none of these, and
the screens render their empty states instead — which look like bugs.

`seed` builds all three on a **past** date so today's live round is untouched,
and attaches them to whichever device the simulator most recently minted. It
deliberately gives the reader a **losing** first-hour day, because that is the
case the reveal's weight line exists to show.

## Test

```bash
pnpm typecheck
pnpm test
```

From the repo root both run across `packages/core`, `apps/mobile` and
`apps/api`. Tests are a sanity check — they will not catch anything this skill
exists to find. Every visual bug found on 2026-09-03 (a header collision, a
clipped screen, a seven-line block) passed the full suite.

## Gotchas

- **The Keychain outlives the app.** `expo-secure-store` is the iOS Keychain,
  which survives app deletion — so a device token whose server row is gone
  (typically: someone reset the dev database) **cannot be cleared by
  reinstalling**. The app sits on `THE ORACLE SLEEPS` against a perfectly
  healthy API, and `curl` to the same endpoint works fine, which is maximally
  confusing. Fix: `driver.mjs reset-identity`. (Current builds self-heal by
  re-minting on a 401; older ones do not.)
- **Metro's "port busy" prompt hangs a non-tty caller forever.** It asks
  *"Use port 8082 instead?"* and waits. `up` checks `lsof` first for exactly
  this reason — never start Metro blind.
- **`wrangler dev` must be started from `apps/api`.** From the repo root it
  exits 1 with no useful message because there is no `wrangler.jsonc` there.
- **The first deep link after a launch is usually swallowed** while the router
  is still mounting, and lands on Home instead. `go` sends it twice.
- **A fresh install opens the dev-client launcher, not the app**, and after
  attaching it leaves the developer-menu sheet over the screen — which cannot be
  dismissed without a tap. `launch` does `terminate` + `launch` afterwards,
  which clears the sheet and keeps the attachment.
- **Never route SQL through `bash -lc`.** The shell eats `$1`, `$2` … as
  positional parameters, silently turning `where date=$1` into `where date=`.
  The driver parses `.dev.vars` itself and passes it as `env`.
- **`@neondatabase/serverless` is not hoisted** to the repo root — this is a
  pnpm workspace. Any script touching the database must run with `apps/api` as
  its cwd. The driver does this for you.
- **neon's `sql` export throws when called as a plain function.** Use
  `sql.query(text, params)`; the tagged-template form is not usable from
  generated code.
- **The dev-tools gear button overlaps the top-right of every screen.** It is
  part of the dev client, not the app — ignore it in screenshots.

## Troubleshooting

| symptom | cause / fix |
|---|---|
| `THE ORACLE SLEEPS` but `curl /v1/health` is fine | stale device token; `driver.mjs reset-identity`, then `launch` |
| every API call 500s | `.dev.vars` missing, or the dev DB is behind on migrations: `cd ../api && export DATABASE_URL=… && pnpm db:migrate` |
| `wrangler dev` exits 1 immediately | started from the wrong directory, or 8787 is already in use |
| `go` lands on Home instead of the route | the router was still mounting; run `go` again |
| reveal shows `DAY POINTS WITHHELD` | the round is not fully resolved — `seed` produces a settled one |
| board says `THE FIELD IS STILL GATHERING` | fewer complete-round players than `CONSTANTS.BOARD_MIN_FIELD`; `seed` clears it |
| plaque shows no standing line | cohort below `CONSTANTS.PERCENTILE_MIN_COHORT`, or the reader has under 50 rated calls |
| `could not read the Simulator window` on `scroll` | the Simulator is not open, or `cliclick` is not installed |

## Not verified here

The dev build was **already installed** on the simulator throughout this
session, so no build command was run and none is documented — per this skill's
own rule that every code block is something that was executed. If
`doctor` reports the app is not installed, building it is an `expo run:ios` /
EAS concern; find the current incantation before trusting one.
