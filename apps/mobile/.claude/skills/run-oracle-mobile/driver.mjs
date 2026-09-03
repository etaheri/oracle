#!/usr/bin/env node
// ORACLE — launch and drive the iOS app from a shell.
//
// The app is an Expo SDK 57 dev-client build on the iOS Simulator, talking to
// a local Cloudflare Worker (apps/api) on :8787 and Metro on :8081. Everything
// here is `xcrun simctl` plus a Postgres connection; there is no Appium, no
// Detox, and deliberately no pixel-tap layer -- see `go` below.
//
// Usage:  node .claude/skills/run-oracle-mobile/driver.mjs <command> [args]
// Run    `... driver.mjs help` for the list.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(SKILL_DIR, "../../.."); // apps/mobile
const REPO = resolve(MOBILE, "../..");
const API = resolve(REPO, "apps/api");

const BUNDLE = "com.erikt.oracle";
const METRO_PORT = 8081;
const API_PORT = 8787;
// The dev client will not attach to Metro on its own after a fresh install --
// it opens its launcher instead. This URL is what points it at the bundler.
const ATTACH_URL = `oracle://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}`;
const SHOTS = process.env.ORACLE_SHOTS ?? resolve(REPO, ".oracle-run");

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const quiet = (cmd, args, opts = {}) => {
  try { return sh(cmd, args, opts); } catch { return ""; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the simulator ────────────────────────────────────────────────────────────

// Prefer whatever is already booted; the developer usually has one open and
// booting a second is slow and confusing. Falls back to the newest available
// iPhone.
function device() {
  if (process.env.ORACLE_SIM) return process.env.ORACLE_SIM;
  const booted = quiet("xcrun", ["simctl", "list", "devices", "booted"]);
  const hit = booted.match(/\(([0-9A-F-]{36})\)\s*\(Booted\)/i);
  if (hit) return hit[1];
  const avail = quiet("xcrun", ["simctl", "list", "devices", "available"]);
  const iphone = [...avail.matchAll(/^\s+(iPhone[^(]*)\(([0-9A-F-]{36})\)/gim)].pop();
  if (!iphone) throw new Error("no iPhone simulator available — open Xcode once, or set ORACLE_SIM");
  const udid = iphone[2];
  sh("xcrun", ["simctl", "boot", udid]);
  return udid;
}

const installed = (udid) => quiet("xcrun", ["simctl", "listapps", udid]).includes(BUNDLE);

// ── background services ──────────────────────────────────────────────────────

const listening = (port) => quiet("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).trim().length > 0;

// Detached, with output to a log file, so the driver can exit while the
// service keeps running. Never started twice: both wrangler and Metro refuse
// a busy port, and Metro's refusal is an INTERACTIVE prompt that hangs a
// non-tty caller forever.
function serve(name, cwd, args, port) {
  if (listening(port)) return `${name}: already up on :${port}`;
  mkdirSync(SHOTS, { recursive: true });
  const log = resolve(SHOTS, `${name}.log`);
  const fd = openSync(log, "a");
  const child = spawn("pnpm", args, { cwd, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  return `${name}: starting on :${port} (log: ${log})`;
}

async function waitFor(port, label, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    if (listening(port)) return true;
    await sleep(1000);
  }
  throw new Error(`${label} did not come up on :${port} — check ${resolve(SHOTS, `${label}.log`)}`);
}

// ── the database ─────────────────────────────────────────────────────────────

// Run a snippet with apps/api as the cwd so `@neondatabase/serverless`
// resolves: this is a pnpm workspace, so that package is NOT hoisted to the
// repo root and a script living in the skill directory cannot import it.
//
// The env is parsed here and handed to node directly, NEVER sourced through a
// shell. Routing the script through `bash -lc` silently ate every `$1`/`$2`
// placeholder in the SQL as a shell positional parameter, turning
// `where date=$1` into `where date=` — a syntax error if you are lucky and a
// wrong query if you are not.
function devVars() {
  const path = resolve(API, ".dev.vars");
  if (!existsSync(path)) throw new Error(`missing ${path} — the api cannot reach Neon without it`);
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  if (!env.DATABASE_URL) throw new Error(".dev.vars has no DATABASE_URL");
  return env;
}

function sql(js) {
  const script = `
    import { neon } from "@neondatabase/serverless";
    const sql = neon(process.env.DATABASE_URL);
    // neon's tagged-template export throws when called as a plain function;
    // sql.query(text, params) is the positional form and the only one usable
    // from generated code like this.
    ${js}
  `;
  return sh("node", ["--input-type=module", "-e", script], {
    cwd: API,
    env: { ...process.env, ...devVars() },
  });
}

// ── commands ─────────────────────────────────────────────────────────────────

const commands = {
  async doctor() {
    const udid = device();
    console.log(`simulator      ${udid}`);
    console.log(`app installed  ${installed(udid) ? "yes" : "NO — build it, see SKILL.md"}`);
    console.log(`metro :${METRO_PORT}    ${listening(METRO_PORT) ? "up" : "down"}`);
    console.log(`api   :${API_PORT}    ${listening(API_PORT) ? "up" : "down"}`);
    console.log(`.dev.vars      ${existsSync(resolve(API, ".dev.vars")) ? "present" : "MISSING — the api cannot reach Neon"}`);
    if (listening(API_PORT)) {
      const health = quiet("curl", ["-s", `http://localhost:${API_PORT}/v1/health`]).trim();
      console.log(`api health     ${health || "(no response)"}`);
    }
    console.log(`screenshots    ${SHOTS}`);
  },

  async up() {
    console.log(serve("api", API, ["wrangler", "dev", "--port", String(API_PORT)], API_PORT));
    console.log(serve("metro", MOBILE, ["expo", "start", "--dev-client"], METRO_PORT));
    await waitFor(API_PORT, "api");
    await waitFor(METRO_PORT, "metro");
    console.log("both up");
  },

  // Attach the dev client to Metro, then restart the app cleanly.
  //
  // The restart is not optional. A fresh install opens the dev-client
  // launcher, and after attaching it leaves the developer-menu sheet sitting
  // over the app -- which cannot be dismissed without a tap. terminate+launch
  // clears it, and the attachment survives.
  async launch() {
    const udid = device();
    if (!installed(udid)) throw new Error(`${BUNDLE} is not installed on ${udid} — see SKILL.md "Build"`);
    quiet("xcrun", ["simctl", "openurl", udid, ATTACH_URL]);
    await sleep(6000);
    quiet("xcrun", ["simctl", "terminate", udid, BUNDLE]);
    await sleep(2000);
    sh("xcrun", ["simctl", "launch", udid, BUNDLE]);
    await sleep(14000); // fonts, Skia, the boot rite
    console.log("launched");
  },

  // Navigate by deep link, NOT by tapping.
  //
  // Pixel taps need the Simulator window's position and a scale factor solved
  // from its title-bar height; they were wrong often enough to waste a session.
  // expo-router serves every screen off the `oracle` scheme, so this is exact.
  // Routes: / · /rites?all=1 · /round · /ledger · /plus · /reveal/<YYYY-MM-DD>
  async go(route = "/") {
    const udid = device();
    const url = `oracle://${route.startsWith("/") ? "" : "/"}${route}`;
    // Twice: the first deep link after a launch is routinely swallowed while
    // the router is still mounting, and lands on Home instead.
    quiet("xcrun", ["simctl", "openurl", udid, url]);
    await sleep(3000);
    quiet("xcrun", ["simctl", "openurl", udid, url]);
    await sleep(5000);
    console.log(`at ${url}`);
  },

  async shot(name = `shot-${Date.now()}`) {
    mkdirSync(SHOTS, { recursive: true });
    const out = resolve(SHOTS, name.endsWith(".png") ? name : `${name}.png`);
    sh("xcrun", ["simctl", "io", device(), "screenshot", out]);
    console.log(out);
  },

  // Scrolling is the one gesture worth doing by pixel, because it needs no
  // accuracy: a drag anywhere down the middle of the window scrolls. Requires
  // `brew install cliclick`.
  async scroll(times = "1") {
    const geo = quiet("osascript", [
      "-e", 'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1',
    ]).trim();
    const [x, y, w, h] = geo.split(",").map((n) => Number(n.trim()));
    if (!w || !h) throw new Error("could not read the Simulator window — is it open and frontmost?");
    quiet("osascript", ["-e", 'tell application "Simulator" to activate']);
    await sleep(800);
    const cx = Math.round(x + w / 2);
    const from = Math.round(y + h * 0.85);
    const to = Math.round(y + h * 0.30);
    for (let i = 0; i < Number(times); i++) {
      quiet("cliclick", [
        `dd:${cx},${from}`,
        `dm:${cx},${Math.round((from + to) / 2)}`,
        `dm:${cx},${to}`,
        `du:${cx},${to}`,
      ]);
      await sleep(1200);
    }
    console.log(`scrolled ${times}`);
  },

  // The dead-install trap. SecureStore is the iOS Keychain, which SURVIVES app
  // deletion -- so a device token whose server row is gone cannot be cleared by
  // reinstalling, and the app sits on THE ORACLE SLEEPS forever against a
  // perfectly healthy server. This happens every time the dev database is
  // wiped. (The app now self-heals on a 401; this stays for older builds and
  // for forcing a genuinely fresh identity.)
  async ["reset-identity"]() {
    const udid = device();
    quiet("xcrun", ["simctl", "terminate", udid, BUNDLE]);
    sh("xcrun", ["simctl", "keychain", udid, "reset"]);
    console.log("keychain reset — the next launch mints a new device and user");
  },

  // Put the app in front of the screens worth looking at.
  //
  // Most of this app is invisible without data: the reveal needs a SETTLED
  // round, the daily board needs a field of complete-round players, and the
  // plaque's standing band needs a cohort of at least CONSTANTS
  // .PERCENTILE_MIN_COHORT scored users. This builds all three on a past date
  // (so today's live round is untouched) and attaches them to whichever device
  // the simulator most recently minted.
  async seed(date = "2026-09-02") {
    const out = sql(`
      const D = ${JSON.stringify(date)};
      const opens = D + "T16:00:00Z";
      const locks = new Date(new Date(D + "T16:00:00Z").getTime() + 86400000).toISOString();

      const dev = (await sql.query("select user_id from devices order by created_at desc limit 1"))[0];
      if (!dev) throw new Error("no device rows — launch the app once so it mints one");
      const U = dev.user_id;

      await sql.query("delete from predictions where question_id in (select id from questions where round_date=$1)", [D]);
      await sql.query("delete from user_rounds where date=$1", [D]);
      await sql.query("delete from questions where round_date=$1", [D]);
      await sql.query("delete from rounds where date=$1", [D]);
      await sql.query("insert into rounds(date,status) values($1,'resolved')", [D]);

      const QS = [
        ["markets","Will the index close above its opening print?","yes",62,140],
        ["sports","Will the home side win in regulation?","no",44,132],
        ["weather","Will the park record measurable rain before noon?","yes",71,128],
        ["culture","Will the film hold the number one slot?","no",38,121],
        ["news","Will the committee publish before the round closes?","yes",55,147],
      ];
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const [cat, text, outcome, pct, cnt] = QS[i];
        const r = await sql.query(
          "insert into questions(round_date,slot,is_big_one,text,category,resolution_criteria,source_name,source_url,opens_at,locks_at,resolve_by,status,outcome,resolved_at,crowd_yes_pct,crowd_count,author_prob) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'resolved',$12,$13,$14,$15,$16) returning id",
          [D, i + 1, i === 4, text, cat, "Per the named source on the closing day.", "reuters", "https://www.reuters.com", opens, locks, locks, outcome, locks, pct, cnt, 0.45 + i * 0.03]);
        ids.push(r[0].id);
      }

      // A field big enough to clear CONSTANTS.BOARD_MIN_FIELD, spread so BEST
      // and MEDIAN are legible.
      for (const t of [268, 190, 137, 120, 96, 44, -30, -88]) {
        const u = (await sql.query("insert into users(streak_current,streak_best,calls_resolved) values(0,0,0) returning id"))[0].id;
        const p = [0.3, 0.25, 0.2, 0.15].map((f) => Math.round(t * f));
        p.push(t - p.reduce((a, b) => a + b, 0));
        for (let i = 0; i < 5; i++)
          await sql.query("insert into predictions(question_id,user_id,answer,confidence,first_hour,brier,points) values($1,$2,true,75,false,0.14,$3)", [ids[i], u, p[i]]);
      }

      // A cohort worth a percentile against.
      for (let i = 0; i < 26; i++)
        await sql.query("insert into users(streak_current,streak_best,calls_resolved,oracle_score) values(0,0,57,$1)", [690 + i * 6]);

      // The reader's own day: all five sealed inside the first hour, and a
      // LOSING total -- the case the reveal's weight line exists to show.
      // raw -25 -> first hour x1.1 -> -28 -> vigil x1.15 -> -32.
      await sql.query("delete from predictions where user_id=$1", [U]);
      const mine = [-8, -6, -5, -3, -3];
      for (let i = 0; i < 5; i++)
        await sql.query("insert into predictions(question_id,user_id,answer,confidence,first_hour,brier,points) values($1,$2,$3,70,true,$4,$5)", [ids[i], U, i % 2 === 0, 0.30 + i * 0.02, mine[i]]);
      await sql.query("insert into user_rounds(user_id,date,vigil_mult) values($1,$2,'1.15') on conflict do nothing", [U, D]);
      await sql.query("update users set streak_current=3, streak_best=5, calls_resolved=57, oracle_score=765 where id=$1", [U]);

      console.log("seeded " + D + " for user " + U);
      console.log("now: driver.mjs go /reveal/" + D + "   and   driver.mjs go /ledger");
    `);
    console.log(out.trim());
  },

  help() {
    console.log(`ORACLE driver — node .claude/skills/run-oracle-mobile/driver.mjs <cmd>

  doctor            simulator, app, ports, .dev.vars, api health
  up                start apps/api (:8787) and Metro (:8081) if down
  launch            attach the dev client to Metro, then restart the app
  go <route>        deep link — / /rites?all=1 /round /ledger /plus /reveal/<date>
  shot [name]       screenshot into ${SHOTS}
  scroll [n]        drag-scroll the frontmost Simulator window (needs cliclick)
  seed [date]       settled round + field + scored cohort, attached to this device
  reset-identity    wipe the sim Keychain (the dead-token trap)

env: ORACLE_SIM (udid), ORACLE_SHOTS (output dir)`);
  },
};

const [cmd = "help", ...args] = process.argv.slice(2);
const fn = commands[cmd];
if (!fn) {
  console.error(`unknown command: ${cmd}`);
  commands.help();
  process.exit(1);
}
try {
  await fn(...args);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
