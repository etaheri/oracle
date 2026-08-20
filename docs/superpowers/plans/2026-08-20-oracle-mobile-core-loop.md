# ORACLE Mobile Core Loop Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable Expo app (`apps/mobile`) running the full daily ritual against the real API: summons → Daily Five with confidence slider → seal → crowd reveal → next-day results reveal. Runs in Expo Go / iOS simulator (no native modules yet — RevenueCat/OneSignal/Skia arrive in Plan 3).

**Architecture:** Expo SDK 57 + expo-router in the existing pnpm monorepo. Server state via TanStack Query; in-round answers via a small zustand store; device-token auth persisted in expo-secure-store; all payloads validated with zod schemas from `@oracle/core`. Styling via a single theme-token module (digital-antiquity: obsidian/bone/gold/oxblood/ash; system serif + mono stand-ins until fonts are licensed). One new API endpoint (crowd-so-far) closes the same-session crowd-reveal gap.

**Tech Stack:** Expo SDK 57 (RN 0.86, React 19.2, New Architecture), expo-router, @tanstack/react-query@5, zustand, react-native-reanimated@4 (ships in Expo Go), expo-secure-store, expo-haptics, vitest for pure logic.

## Global Constraints

- All API request/response shapes come from `@oracle/core` zod schemas — mobile never hand-writes a payload type. New schemas added to core, not mobile.
- Theme tokens (only source of color/type — never inline hex in components): obsidian `#0C0A07`, panel `#12100B`, bone `#E9E1CD`, boneDim `#B5AC97`, ash `#8D8677`, gold `#C9A24B`, goldBright `#E4C878`, oxblood `#B04A38`. Serif = system serif stand-in (`Platform.select({ios:"Didot", default:"serif"})`), mono = `Platform.select({ios:"Menlo", default:"monospace"})`.
- Copy voice is mystic-playful and NEVER uses betting vocabulary (bet, odds, wager, payout). Buttons: "SEAL THE PROPHECY", confidence readings per the ladder in Task 6.
- Confidence is an integer 55–95 step 5 (grid from `CONSTANTS`); the slider must be unable to produce any other value.
- Spoiler wall client-side too: crowd percentages and the Oracle's forecast are never rendered for a question the player hasn't sealed.
- Idempotency keys are generated client-side once per (question, install) and reused on retry.
- `pnpm typecheck` and `pnpm test` at repo root must stay green after every task (mobile adds its own typecheck/test scripts in Task 1).
- API base URL from `process.env.EXPO_PUBLIC_API_URL` (default `http://localhost:8787` for simulator dev).
- Commit after every green step; conventional messages.

---

### Task 1: Expo app scaffold in the monorepo

**Files:**
- Create: `apps/mobile/` via create-expo-app (SDK 57 default template, TypeScript + expo-router)
- Create: `.npmrc` (repo root), `apps/mobile/vitest.config.ts`
- Modify: `apps/mobile/package.json` (name, scripts), `apps/mobile/tsconfig.json`, `apps/mobile/app.json`

**Interfaces:**
- Produces: workspace package `@oracle/mobile` with scripts `typecheck` (`tsc --noEmit`) and `test` (`vitest run`, passing with a placeholder-free smoke test in later tasks; for now `vitest run --passWithNoTests`); expo-router entry with a single `app/index.tsx` rendering a black screen with "ORACLE" (proves the pipeline).

- [ ] **Step 1: pnpm/Expo compatibility**

Create repo-root `.npmrc`:
```
node-linker=hoisted
```
Then `pnpm install` (relinks existing packages hoisted; re-run root `pnpm test` to confirm 49 still green).

- [ ] **Step 2: Scaffold**

```bash
cd apps && pnpm dlx create-expo-app@latest mobile --template default --no-install && cd ..
```
Edit `apps/mobile/package.json`: set `"name": "@oracle/mobile"`, add scripts `"typecheck": "tsc --noEmit"`, `"test": "vitest run --passWithNoTests"`. Remove the template's example screens/components (`app/(tabs)`, example components), leaving `app/_layout.tsx` and a new `app/index.tsx`:

```tsx
import { View, Text } from "react-native";

export default function Index() {
  return (
    <View style={{ flex: 1, backgroundColor: "#0C0A07", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#C9A24B", fontSize: 32, letterSpacing: 12 }}>ORACLE</Text>
    </View>
  );
}
```
(The inline hex here is temporary scaffold proof; Task 2 replaces it with tokens.)

`app/_layout.tsx`:
```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0C0A07" } }} />;
}
```

`apps/mobile/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 3: Install workspace deps**

```bash
pnpm install
pnpm add --filter @oracle/mobile @oracle/core@workspace:* zustand @tanstack/react-query
pnpm --filter @oracle/mobile exec npx expo install expo-secure-store expo-haptics react-native-reanimated
pnpm add -D --filter @oracle/mobile vitest
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test` (root) — mobile typechecks, 49 existing tests green.
Run: `pnpm --filter @oracle/mobile exec npx expo export --platform ios --output-dir /tmp/expo-export-check` — bundles without error (proves router + RN build pipeline). Delete the export dir.

- [ ] **Step 5: Commit**

```bash
git add .npmrc apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): scaffold Expo SDK 57 app with expo-router in monorepo"
```

---

### Task 2: Theme tokens + UI primitives

**Files:**
- Create: `apps/mobile/src/theme.ts`, `apps/mobile/src/ui/Text.tsx`, `apps/mobile/src/ui/Screen.tsx`, `apps/mobile/src/ui/Button.tsx`
- Modify: `apps/mobile/app/index.tsx` (use primitives)

**Interfaces:**
- Produces:
```ts
// theme.ts
export const colors = { obsidian:"#0C0A07", panel:"#12100B", bone:"#E9E1CD", boneDim:"#B5AC97", ash:"#8D8677", gold:"#C9A24B", goldBright:"#E4C878", oxblood:"#B04A38", line:"rgba(201,162,75,0.18)" } as const;
export const fonts = { serif: string, mono: string };  // Platform.select stand-ins
export const space = (n: number) => n * 4;
```
- `<Serif size weight color>` / `<Mono size color letterSpacing>` text components; `<Screen>` (SafeArea + obsidian bg + padding); `<GoldButton title onPress disabled>` (bordered gold, mono uppercase letterspaced, haptic on press).

- [ ] **Step 1: Implement theme.ts**

```ts
import { Platform } from "react-native";

export const colors = {
  obsidian: "#0C0A07", panel: "#12100B", bone: "#E9E1CD", boneDim: "#B5AC97",
  ash: "#8D8677", gold: "#C9A24B", goldBright: "#E4C878", oxblood: "#B04A38",
  line: "rgba(201,162,75,0.18)",
} as const;

export const fonts = {
  serif: Platform.select({ ios: "Didot", default: "serif" })!,
  mono: Platform.select({ ios: "Menlo", default: "monospace" })!,
};

export const space = (n: number) => n * 4;
```

- [ ] **Step 2: Implement primitives**

`src/ui/Text.tsx`:
```tsx
import { Text, type TextProps } from "react-native";
import { colors, fonts } from "../theme";

export function Serif({ size = 18, color = colors.bone, style, ...rest }: TextProps & { size?: number; color?: string }) {
  return <Text {...rest} style={[{ fontFamily: fonts.serif, fontSize: size, color }, style]} />;
}

export function Mono({ size = 13, color = colors.boneDim, letterSpacing = 0.5, style, ...rest }: TextProps & { size?: number; color?: string; letterSpacing?: number }) {
  return <Text {...rest} style={[{ fontFamily: fonts.mono, fontSize: size, color, letterSpacing }, style]} />;
}

export function Eyebrow({ children }: { children: string }) {
  return <Mono size={10} color={colors.gold} letterSpacing={4} style={{ textTransform: "uppercase", textAlign: "center" }}>{children}</Mono>;
}
```

`src/ui/Screen.tsx`:
```tsx
import { SafeAreaView, View } from "react-native";
import { colors, space } from "../theme";

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.obsidian }}>
      <View style={{ flex: 1, padding: space(5) }}>{children}</View>
    </SafeAreaView>
  );
}
```

`src/ui/Button.tsx`:
```tsx
import { Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, space } from "../theme";
import { Mono } from "./Text";

export function GoldButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }}
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: disabled ? colors.line : colors.gold,
        paddingVertical: space(3), alignItems: "center",
        opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
        backgroundColor: pressed ? "rgba(201,162,75,0.08)" : "transparent",
      })}
    >
      <Mono size={12} color={disabled ? colors.ash : colors.gold} letterSpacing={6} style={{ textTransform: "uppercase" }}>{title}</Mono>
    </Pressable>
  );
}
```

Update `app/index.tsx` to render `<Screen><Eyebrow>Oracle OS v1.0</Eyebrow><Serif size={40} ...>ORACLE</Serif></Screen>`-style composition using only tokens (no inline hex remains anywhere in app/).

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @oracle/mobile typecheck` → clean; grep `#0C0A07` in `apps/mobile/app/` → only theme.ts holds hex values.
```bash
git add apps/mobile/src apps/mobile/app
git commit -m "feat(mobile): digital-antiquity theme tokens and UI primitives"
```

---

### Task 3: Crowd-so-far API endpoint (backend, closes the same-session reveal gap)

**Files:**
- Create: `apps/api/test/crowd.test.ts`
- Modify: `apps/api/src/routes/round.ts` (add `GET /today/crowd`), `packages/core/src/schemas.ts` (response schema)

**Interfaces:**
- Produces: `GET /v1/round/today/crowd` (device auth) → `{ questions: [{ id, crowd_yes_pct: number, player_count: number }] }` — **only** for questions of the open round that the CALLING USER has already submitted a prediction for; questions they haven't sealed are omitted entirely (spoiler wall). Percentages computed live from the predictions table. Core schema `CrowdSoFarSchema` for the response.

- [ ] **Step 1: Add `CrowdSoFarSchema` to `packages/core/src/schemas.ts`**

```ts
export const CrowdSoFarSchema = z.object({
  questions: z.array(z.object({
    id: z.string().uuid(),
    crowd_yes_pct: z.number().int().min(0).max(100),
    player_count: z.number().int().min(0),
  })),
});
export type CrowdSoFar = z.infer<typeof CrowdSoFarSchema>;
```

- [ ] **Step 2: Write failing tests** (`apps/api/test/crowd.test.ts`)

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 75, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("GET /v1/round/today/crowd", () => {
  it("returns crowd % only for questions the caller sealed", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await b("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) }); // a did NOT seal q2

    const res = await a("/v1/round/today/crowd");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { questions: Array<{ id: string; crowd_yes_pct: number; player_count: number }> };
    expect(out.questions).toHaveLength(1); // only q1 — a hasn't sealed q2
    expect(out.questions[0]).toEqual({ id: qs[0]!.id, crowd_yes_pct: 33, player_count: 3 });
  });
  it("empty list when the caller sealed nothing; 404 with no open round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    expect((await a("/v1/round/today/crowd")).status).toBe(404);
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await a("/v1/round/today/crowd");
    expect(((await res.json()) as { questions: unknown[] }).questions).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify failure, implement, run to green**

Add to `roundRoutes` in `apps/api/src/routes/round.ts` (before the `/:date/reveal` route so `/today/crowd` isn't captured by the `:date` param — route order matters in Hono):
```ts
.get("/today/crowd", async (c) => {
  const { db } = c.get("deps");
  const userId = c.get("userId");
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "open") });
  if (!round) return c.json({ error: "no open round" }, 404);
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, round.date) });
  const qIds = qs.map((q) => q.id);
  const preds = qIds.length
    ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qIds) })
    : [];
  const mine = new Set(preds.filter((p) => p.userId === userId).map((p) => p.questionId));
  const questions = [...mine].map((qid) => {
    const ofQ = preds.filter((p) => p.questionId === qid);
    const yes = ofQ.filter((p) => p.answer).length;
    return { id: qid, crowd_yes_pct: Math.round((100 * yes) / ofQ.length), player_count: ofQ.length };
  });
  return c.json({ questions });
})
```
Run: `pnpm --filter @oracle/api test` → green (both new tests + all existing).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/schemas.ts apps/api/src/routes/round.ts apps/api/test/crowd.test.ts
git commit -m "feat(api): crowd-so-far endpoint for same-session reveal (sealed questions only)"
```

---

### Task 4: Mobile API client + device auth

**Files:**
- Create: `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/auth.ts`
- Test: `apps/mobile/test/client.test.ts`

**Interfaces:**
- Produces:
```ts
// auth.ts
export async function getDeviceToken(deps?: { fetchFn?: typeof fetch; store?: TokenStore }): Promise<string>; // mints via POST /v1/auth/device on first call, persists in SecureStore, returns cached afterwards
export interface TokenStore { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; }
// client.ts
export async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit & { fetchFn?: typeof fetch; token?: string }): Promise<T>; // adds Bearer, JSON headers, throws ApiError{status} on !ok, zod-parses response
export class ApiError extends Error { status: number }
export const API_URL: string; // from EXPO_PUBLIC_API_URL, default http://localhost:8787
```
- Both functions take injectable `fetchFn`/`store` so vitest tests run in Node with no RN imports on the tested path (SecureStore wrapper lives behind the `TokenStore` interface; the default implementation imports expo-secure-store lazily).

- [ ] **Step 1: Write failing tests** (`apps/mobile/test/client.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { api, ApiError } from "../src/api/client";
import { getDeviceToken, type TokenStore } from "../src/api/auth";
import { z } from "zod";

const memStore = (): TokenStore => {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
};

describe("api()", () => {
  it("parses a valid response and sends bearer + json headers", async () => {
    let seen: RequestInit | undefined;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const out = await api("/v1/health", z.object({ ok: z.boolean() }), { fetchFn, token: "tok" });
    expect(out).toEqual({ ok: true });
    expect((seen!.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("throws ApiError with status on non-ok", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: "locked" }), { status: 409 })) as typeof fetch;
    await expect(api("/v1/predictions", z.unknown(), { fetchFn, token: "t" })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects when the response fails schema validation", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as typeof fetch;
    await expect(api("/v1/health", z.object({ ok: z.boolean() }), { fetchFn, token: "t" })).rejects.toThrow();
  });
});

describe("getDeviceToken()", () => {
  it("mints once then caches in the store", async () => {
    let mints = 0;
    const fetchFn = (async () => { mints++; return new Response(JSON.stringify({ token: "minted.1.abc", user_id: "u" }), { status: 200 }); }) as typeof fetch;
    const store = memStore();
    expect(await getDeviceToken({ fetchFn, store })).toBe("minted.1.abc");
    expect(await getDeviceToken({ fetchFn, store })).toBe("minted.1.abc");
    expect(mints).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure, implement**

`src/api/client.ts`:
```ts
import type { z } from "zod";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & { fetchFn?: typeof fetch; token?: string } = {},
): Promise<T> {
  const { fetchFn = fetch, token, ...rest } = init;
  const res = await fetchFn(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} on ${path}`);
  return schema.parse(await res.json());
}
```

`src/api/auth.ts`:
```ts
import { z } from "zod";
import { api } from "./client";

export interface TokenStore { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; }

const KEY = "oracle.device_token";
const MintSchema = z.object({ token: z.string(), user_id: z.string() });

async function secureStore(): Promise<TokenStore> {
  const SecureStore = await import("expo-secure-store");
  return { get: (k) => SecureStore.getItemAsync(k), set: (k, v) => SecureStore.setItemAsync(k, v) };
}

export async function getDeviceToken(deps: { fetchFn?: typeof fetch; store?: TokenStore } = {}): Promise<string> {
  const store = deps.store ?? (await secureStore());
  const existing = await store.get(KEY);
  if (existing) return existing;
  const { token } = await api("/v1/auth/device", MintSchema, {
    method: "POST",
    body: JSON.stringify({ platform: "ios" }),
    fetchFn: deps.fetchFn,
  });
  await store.set(KEY, token);
  return token;
}
```
Update mobile `package.json` test script to `"test": "vitest run"`.

- [ ] **Step 3: Run to green + commit**

Run: `pnpm --filter @oracle/mobile test` → 5 tests green; root `pnpm typecheck && pnpm test` green.
```bash
git add apps/mobile/src/api apps/mobile/test apps/mobile/package.json
git commit -m "feat(mobile): typed API client and device-token auth with injectable deps"
```

---

### Task 5: Query hooks + round schemas

**Files:**
- Create: `apps/mobile/src/api/hooks.ts`
- Modify: `packages/core/src/schemas.ts` (add `RoundTodaySchema`, `RevealSchema`), `apps/mobile/app/_layout.tsx` (QueryClientProvider)
- Test: `packages/core/test/round-schemas.test.ts`

**Interfaces:**
- Produces (in core):
```ts
export const RoundTodaySchema = z.object({
  date: z.string(), locks_at: z.string().nullable(), player_count: z.number().int(),
  questions: z.array(z.object({
    id: z.string().uuid(), slot: z.number().int(), is_big_one: z.boolean(),
    text: z.string(), category: z.string(), source_name: z.string(), resolution_criteria: z.string(),
  })),
});
export type RoundToday = z.infer<typeof RoundTodaySchema>;
export const RevealSchema = z.object({
  date: z.string(), day_points: z.number().int(),
  questions: z.array(z.object({
    id: z.string().uuid(), slot: z.number().int(), text: z.string(),
    outcome: z.enum(["yes", "no", "void"]).nullable(),
    crowd_yes_pct: z.number().nullable(),
    my: z.object({ answer: z.boolean(), confidence: z.number().int(), points: z.number().int().nullable(), brier: z.number().nullable() }).nullable(),
  })),
});
export type Reveal = z.infer<typeof RevealSchema>;
```
- Produces (in mobile `hooks.ts`): `useToday()` (query, 404 → `null` data), `useCrowdSoFar(enabled)` (poll 10s while enabled), `useReveal(date)` (409 → `{ pending: true }`), `useSubmit()` (mutation posting `PredictionSubmit`, invalidates crowd query). All hooks resolve the device token internally via `getDeviceToken()`.

- [ ] **Step 1: Core schema test** (`packages/core/test/round-schemas.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { RoundTodaySchema, RevealSchema } from "../src/schemas";

describe("round schemas", () => {
  it("parses a real /round/today payload", () => {
    const payload = {
      date: "2026-08-20", locks_at: "2026-08-21T16:00:00.000Z", player_count: 3,
      questions: [{ id: "11111111-1111-4111-8111-111111111111", slot: 1, is_big_one: false, text: "Q?", category: "markets", source_name: "S&P", resolution_criteria: "close" }],
    };
    expect(RoundTodaySchema.parse(payload)).toEqual(payload);
  });
  it("parses a real reveal payload incl. void and null my", () => {
    const payload = {
      date: "2026-08-20", day_points: 224,
      questions: [{ id: "44444444-4444-4444-8444-444444444444", slot: 4, text: "Q?", outcome: "void", crowd_yes_pct: null, my: null }],
    };
    expect(RevealSchema.parse(payload)).toEqual(payload);
  });
});
```
Add the two schemas to `packages/core/src/schemas.ts` exactly as in Interfaces; run core tests green.

- [ ] **Step 2: Implement hooks**

`src/api/hooks.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RoundTodaySchema, RevealSchema, CrowdSoFarSchema, type PredictionSubmit } from "@oracle/core";
import { z } from "zod";
import { api, ApiError } from "./client";
import { getDeviceToken } from "./auth";

export function useToday() {
  return useQuery({
    queryKey: ["round", "today"],
    queryFn: async () => {
      const token = await getDeviceToken();
      try { return await api("/v1/round/today", RoundTodaySchema, { token }); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    },
  });
}

export function useCrowdSoFar(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "crowd"],
    enabled,
    refetchInterval: 10_000,
    queryFn: async () => api("/v1/round/today/crowd", CrowdSoFarSchema, { token: await getDeviceToken() }),
  });
}

export function useReveal(date: string | null) {
  return useQuery({
    queryKey: ["reveal", date],
    enabled: date !== null,
    queryFn: async () => {
      const token = await getDeviceToken();
      try { return await api(`/v1/round/${date}/reveal`, RevealSchema, { token }); }
      catch (e) { if (e instanceof ApiError && e.status === 409) return { pending: true } as const; throw e; }
    },
  });
}

const SubmitResSchema = z.object({ id: z.string(), first_hour: z.boolean() });

export function useSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: PredictionSubmit) =>
      api("/v1/predictions", SubmitResSchema, { method: "POST", body: JSON.stringify(p), token: await getDeviceToken() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["round", "crowd"] }); },
  });
}
```

`app/_layout.tsx` gains the provider:
```tsx
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0C0A07" } }} />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 3: Verify + commit**

Root `pnpm typecheck && pnpm test` green.
```bash
git add packages/core apps/mobile/src/api/hooks.ts apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): round/reveal/crowd schemas and query hooks"
```

---

### Task 6: Confidence slider

**Files:**
- Create: `apps/mobile/src/game/confidence.ts`, `apps/mobile/src/ui/ConfidenceSlider.tsx`
- Test: `apps/mobile/test/confidence.test.ts`

**Interfaces:**
- Produces:
  - `snapConfidence(ratio: number): number` — pure: maps a 0..1 track ratio to the 55–95 step-5 grid (clamped; uses `CONSTANTS`).
  - `confidenceReading(c: number): string` — the mystic ladder: 55 "A WHISPER OF A HUNCH", 60 "THE MISTS STIR", 65 "AN OMEN TAKES SHAPE", 70 "THE PATTERN EMERGES", 75 "THE SIGNS ARE CLEAR", 80 "THE STARS ALIGN", 85 "THE VISION IS VIVID", 90 "FATE WHISPERS ITS ANSWER", 95 "THE PROPHECY IS CERTAIN".
  - `<ConfidenceSlider value onChange>` — Pressable-pan track (Reanimated-free implementation using PanResponder is acceptable; if Reanimated gesture is used it must stay Expo Go-compatible), gold fill, tick labels, reading line; emits only grid values; light haptic on each detent change.

- [ ] **Step 1: Failing tests** (`apps/mobile/test/confidence.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { snapConfidence, confidenceReading } from "../src/game/confidence";

describe("snapConfidence", () => {
  it("maps ratio extremes to grid extremes and clamps", () => {
    expect(snapConfidence(0)).toBe(55);
    expect(snapConfidence(1)).toBe(95);
    expect(snapConfidence(-0.5)).toBe(55);
    expect(snapConfidence(1.5)).toBe(95);
  });
  it("snaps to nearest step-5 detent", () => {
    expect(snapConfidence(0.5)).toBe(75);
    expect(snapConfidence(0.49)).toBe(75);
    expect(snapConfidence(0.55)).toBe(75);
    expect(snapConfidence(0.62)).toBe(80);
  });
  it("only ever produces grid values", () => {
    for (let r = 0; r <= 1.0001; r += 0.01) {
      const c = snapConfidence(r);
      expect(c).toBeGreaterThanOrEqual(55);
      expect(c).toBeLessThanOrEqual(95);
      expect((c - 55) % 5).toBe(0);
    }
  });
});

describe("confidenceReading", () => {
  it("has a distinct line for every detent", () => {
    const seen = new Set<string>();
    for (let c = 55; c <= 95; c += 5) seen.add(confidenceReading(c));
    expect(seen.size).toBe(9);
    expect(confidenceReading(75)).toBe("THE SIGNS ARE CLEAR");
  });
});
```

- [ ] **Step 2: Implement pure logic**

`src/game/confidence.ts`:
```ts
import { CONSTANTS as C } from "@oracle/core";

export function snapConfidence(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  const steps = (C.CONFIDENCE_MAX - C.CONFIDENCE_MIN) / C.CONFIDENCE_STEP; // 8
  return C.CONFIDENCE_MIN + Math.round(clamped * steps) * C.CONFIDENCE_STEP;
}

const READINGS: Record<number, string> = {
  55: "A WHISPER OF A HUNCH", 60: "THE MISTS STIR", 65: "AN OMEN TAKES SHAPE",
  70: "THE PATTERN EMERGES", 75: "THE SIGNS ARE CLEAR", 80: "THE STARS ALIGN",
  85: "THE VISION IS VIVID", 90: "FATE WHISPERS ITS ANSWER", 95: "THE PROPHECY IS CERTAIN",
};
export function confidenceReading(c: number): string {
  return READINGS[c] ?? READINGS[75]!;
}
```

- [ ] **Step 3: Implement the component**

`src/ui/ConfidenceSlider.tsx`:
```tsx
import { useRef, useState } from "react";
import { View, PanResponder, LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, space } from "../theme";
import { Mono } from "./Text";
import { snapConfidence, confidenceReading } from "../game/confidence";

export function ConfidenceSlider({ value, onChange }: { value: number; onChange: (c: number) => void }) {
  const [width, setWidth] = useState(1);
  const valueRef = useRef(value);
  valueRef.current = value;
  const widthRef = useRef(1);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => update(e.nativeEvent.locationX),
      onPanResponderMove: (e) => update(e.nativeEvent.locationX),
    }),
  ).current;

  function update(x: number) {
    const next = snapConfidence(x / widthRef.current);
    if (next !== valueRef.current) {
      Haptics.selectionAsync();
      onChange(next);
    }
  }

  const ratio = (value - 55) / 40;
  return (
    <View style={{ gap: space(1.5) }}>
      <View
        {...pan.panHandlers}
        onLayout={(e: LayoutChangeEvent) => { setWidth(e.nativeEvent.layout.width); widthRef.current = e.nativeEvent.layout.width; }}
        style={{ height: 36, justifyContent: "center" }}
        accessibilityRole="adjustable"
        accessibilityLabel="Confidence"
        accessibilityValue={{ text: `${value} percent` }}
      >
        <View style={{ height: 2, backgroundColor: "rgba(233,225,205,0.10)" }}>
          <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: ratio * width, backgroundColor: colors.gold }} />
        </View>
        <View style={{
          position: "absolute", left: Math.max(0, ratio * width - 8), width: 16, height: 16, borderRadius: 8,
          backgroundColor: colors.obsidian, borderWidth: 1.5, borderColor: colors.gold,
        }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {[55, 65, 75, 85, 95].map((t) => <Mono key={t} size={9} color={colors.ash}>{String(t)}</Mono>)}
      </View>
      <Mono size={11} color={colors.gold} letterSpacing={2} style={{ textAlign: "center" }}>
        {value}% · {confidenceReading(value)}
      </Mono>
    </View>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @oracle/mobile test` (new tests green) and root typecheck.
```bash
git add apps/mobile/src/game apps/mobile/src/ui/ConfidenceSlider.tsx apps/mobile/test/confidence.test.ts
git commit -m "feat(mobile): confidence slider with grid snapping and mystic readings"
```

---

### Task 7: In-round store + question card

**Files:**
- Create: `apps/mobile/src/game/roundStore.ts`, `apps/mobile/src/ui/QuestionCard.tsx`
- Test: `apps/mobile/test/roundStore.test.ts`

**Interfaces:**
- Produces:
```ts
// roundStore.ts (zustand, no persistence — a round is one sitting; server is source of truth)
interface RoundState {
  answers: Record<string, { answer: boolean; confidence: number; sealed: boolean; idempotencyKey: string }>;
  setAnswer(qid: string, answer: boolean): void;      // initializes confidence 75 if unset
  setConfidence(qid: string, confidence: number): void;
  markSealed(qid: string): void;
  reset(): void;
}
export const useRoundStore: UseBoundStore<StoreApi<RoundState>>;
export function makeIdempotencyKey(qid: string): string; // `${qid}:${random}` stable per store entry
```
- `<QuestionCard q onSealed>` — renders question text (Serif), category/big-one eyebrow, source line ("resolves per {source_name}"), YES/NO toggle, `ConfidenceSlider`, and a "SEAL THE PROPHECY" `GoldButton` that calls `useSubmit()` and then `onSealed()`. Submit errors: 409 shows "THE ORACLE HAS CLOSED" inline (Mono, oxblood); other errors show "THE CONNECTION WAVERS — TRY AGAIN".

- [ ] **Step 1: Failing store tests** (`apps/mobile/test/roundStore.test.ts`)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useRoundStore } from "../src/game/roundStore";

beforeEach(() => useRoundStore.getState().reset());

describe("roundStore", () => {
  it("initializes confidence at 75 on first answer", () => {
    useRoundStore.getState().setAnswer("q1", true);
    const a = useRoundStore.getState().answers["q1"]!;
    expect(a).toMatchObject({ answer: true, confidence: 75, sealed: false });
    expect(a.idempotencyKey).toContain("q1:");
  });
  it("keeps confidence and key when flipping answer", () => {
    const s = useRoundStore.getState();
    s.setAnswer("q1", true);
    s.setConfidence("q1", 90);
    const key = useRoundStore.getState().answers["q1"]!.idempotencyKey;
    useRoundStore.getState().setAnswer("q1", false);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ answer: false, confidence: 90, idempotencyKey: key });
  });
  it("markSealed locks the entry", () => {
    useRoundStore.getState().setAnswer("q1", true);
    useRoundStore.getState().markSealed("q1");
    expect(useRoundStore.getState().answers["q1"]!.sealed).toBe(true);
  });
});
```

- [ ] **Step 2: Implement store**

`src/game/roundStore.ts`:
```ts
import { create } from "zustand";

export function makeIdempotencyKey(qid: string): string {
  return `${qid}:${Math.random().toString(36).slice(2, 10)}`;
}

interface Entry { answer: boolean; confidence: number; sealed: boolean; idempotencyKey: string }
interface RoundState {
  answers: Record<string, Entry>;
  setAnswer(qid: string, answer: boolean): void;
  setConfidence(qid: string, confidence: number): void;
  markSealed(qid: string): void;
  reset(): void;
}

export const useRoundStore = create<RoundState>((set) => ({
  answers: {},
  setAnswer: (qid, answer) => set((s) => ({
    answers: { ...s.answers, [qid]: { confidence: 75, sealed: false, idempotencyKey: makeIdempotencyKey(qid), ...s.answers[qid], answer } },
  })),
  setConfidence: (qid, confidence) => set((s) => s.answers[qid] ? ({ answers: { ...s.answers, [qid]: { ...s.answers[qid]!, confidence } } }) : s),
  markSealed: (qid) => set((s) => s.answers[qid] ? ({ answers: { ...s.answers, [qid]: { ...s.answers[qid]!, sealed: true } } }) : s),
  reset: () => set({ answers: {} }),
}));
```

- [ ] **Step 3: Implement QuestionCard**

`src/ui/QuestionCard.tsx`:
```tsx
import { useState } from "react";
import { View, Pressable } from "react-native";
import { ApiError } from "../api/client";
import { useSubmit } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { colors, space } from "../theme";
import { Serif, Mono, Eyebrow } from "./Text";
import { GoldButton } from "./Button";
import { ConfidenceSlider } from "./ConfidenceSlider";
import type { RoundToday } from "@oracle/core";

export function QuestionCard({ q, onSealed }: { q: RoundToday["questions"][number]; onSealed: () => void }) {
  const { answers, setAnswer, setConfidence, markSealed } = useRoundStore();
  const entry = answers[q.id];
  const submit = useSubmit();
  const [error, setError] = useState<string | null>(null);

  async function seal() {
    if (!entry) return;
    setError(null);
    try {
      await submit.mutateAsync({ question_id: q.id, answer: entry.answer, confidence: entry.confidence, idempotency_key: entry.idempotencyKey });
      markSealed(q.id);
      onSealed();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "THE ORACLE HAS CLOSED" : "THE CONNECTION WAVERS — TRY AGAIN");
    }
  }

  return (
    <View style={{ borderWidth: 1, borderColor: q.is_big_one ? colors.gold : colors.line, backgroundColor: colors.panel, padding: space(4), gap: space(3) }}>
      <Eyebrow>{q.is_big_one ? "✶ The Big One · worth double" : q.category}</Eyebrow>
      <Serif size={22} style={{ lineHeight: 30 }}>{q.text}</Serif>
      <Mono size={10} color={colors.ash}>resolves per {q.source_name}</Mono>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        {([true, false] as const).map((v) => {
          const sel = entry?.answer === v;
          return (
            <Pressable key={String(v)} accessibilityRole="button" onPress={() => setAnswer(q.id, v)}
              style={{ flex: 1, borderWidth: 1, borderColor: sel ? colors.gold : colors.line, paddingVertical: space(2.5), alignItems: "center", backgroundColor: sel ? "rgba(201,162,75,0.08)" : "transparent" }}>
              <Mono size={12} color={sel ? colors.gold : colors.boneDim} letterSpacing={5}>{v ? "YES" : "NO"}</Mono>
            </Pressable>
          );
        })}
      </View>
      {entry && <ConfidenceSlider value={entry.confidence} onChange={(c) => setConfidence(q.id, c)} />}
      {error && <Mono size={11} color={colors.oxblood} style={{ textAlign: "center" }}>{error}</Mono>}
      <GoldButton title={submit.isPending ? "SEALING…" : "SEAL THE PROPHECY"} onPress={seal} disabled={!entry || submit.isPending} />
    </View>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run mobile tests + root typecheck green.
```bash
git add apps/mobile/src/game/roundStore.ts apps/mobile/src/ui/QuestionCard.tsx apps/mobile/test/roundStore.test.ts
git commit -m "feat(mobile): in-round store and question card with seal flow"
```

---

### Task 8: Round flow screen + crowd reveal

**Files:**
- Create: `apps/mobile/app/round.tsx`, `apps/mobile/src/ui/CrowdReveal.tsx`

**Interfaces:**
- Consumes: `useToday`, `useCrowdSoFar`, `useRoundStore`, `QuestionCard`.
- Produces: `/round` route — steps through unsealed questions slot-by-slot (progress dots at bottom: gold = sealed); when ALL questions are sealed, renders `<CrowdReveal>`: for each question a row with the player's call and an animated gold bar showing `crowd_yes_pct` (from `useCrowdSoFar(true)` — live, refetching every 10s), plus "N ORACLES CONSULTED" and a note "the ledger is read tomorrow at noon". Reanimated `withTiming` bar-fill on mount; no crowd data rendered for unsealed questions (they can't exist at this point, but the component filters by sealed ids anyway — defense in depth).

- [ ] **Step 1: Implement CrowdReveal**

`src/ui/CrowdReveal.tsx`:
```tsx
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { colors, space } from "../theme";
import { Serif, Mono, Eyebrow } from "./Text";
import { useCrowdSoFar } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import type { RoundToday } from "@oracle/core";

function Bar({ pct }: { pct: number }) {
  const w = useSharedValue(0);
  useEffect(() => { w.value = withTiming(pct, { duration: 900 }); }, [pct, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  return (
    <View style={{ height: 3, backgroundColor: "rgba(233,225,205,0.10)" }}>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.gold }, style]} />
    </View>
  );
}

export function CrowdReveal({ round }: { round: RoundToday }) {
  const crowd = useCrowdSoFar(true);
  const answers = useRoundStore((s) => s.answers);
  const byId = new Map((crowd.data?.questions ?? []).map((c) => [c.id, c]));
  const sealed = round.questions.filter((q) => answers[q.id]?.sealed && byId.has(q.id));
  const playerCount = Math.max(0, ...sealed.map((q) => byId.get(q.id)!.player_count));

  return (
    <View style={{ flex: 1, gap: space(4) }}>
      <Eyebrow>The crowd is revealed</Eyebrow>
      <View style={{ gap: space(4), flex: 1 }}>
        {sealed.map((q) => {
          const c = byId.get(q.id)!;
          const mine = answers[q.id]!;
          const mySidePct = mine.answer ? c.crowd_yes_pct : 100 - c.crowd_yes_pct;
          return (
            <View key={q.id} style={{ gap: space(1.5) }}>
              <Serif size={15} color={colors.boneDim} numberOfLines={1}>{q.text}</Serif>
              <Bar pct={c.crowd_yes_pct} />
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Mono size={10} color={colors.gold}>{c.crowd_yes_pct}% SAY YES</Mono>
                <Mono size={10} color={mySidePct < 40 ? colors.goldBright : colors.ash}>
                  {mine.answer ? "YOU: YES" : "YOU: NO"} @ {mine.confidence}%{mySidePct < 40 ? " · AGAINST THE TIDE" : ""}
                </Mono>
              </View>
            </View>
          );
        })}
      </View>
      <Mono size={11} color={colors.gold} style={{ textAlign: "center" }} letterSpacing={2}>
        {playerCount} ORACLES CONSULTED
      </Mono>
      <Mono size={10} color={colors.ash} style={{ textAlign: "center" }}>
        The ledger is read tomorrow at noon.
      </Mono>
    </View>
  );
}
```

- [ ] **Step 2: Implement the round screen**

`app/round.tsx`:
```tsx
import { useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Screen } from "../src/ui/Screen";
import { Serif, Mono, Eyebrow } from "../src/ui/Text";
import { QuestionCard } from "../src/ui/QuestionCard";
import { CrowdReveal } from "../src/ui/CrowdReveal";
import { useToday } from "../src/api/hooks";
import { useRoundStore } from "../src/game/roundStore";
import { colors, space } from "../src/theme";

export default function Round() {
  const today = useToday();
  const answers = useRoundStore((s) => s.answers);
  const [, force] = useState(0);

  if (today.isLoading) return <Screen><ActivityIndicator color={colors.gold} /></Screen>;
  if (!today.data) return <Screen><Eyebrow>The oracle sleeps</Eyebrow><Serif size={20}>No round is open.</Serif></Screen>;

  const qs = [...today.data.questions].sort((a, b) => a.slot - b.slot);
  const current = qs.find((q) => !answers[q.id]?.sealed);

  return (
    <Screen>
      <Eyebrow>Oracle OS v1.0 · Day {today.data.date}</Eyebrow>
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        {current ? <QuestionCard q={current} onSealed={() => force((n) => n + 1)} /> : <CrowdReveal round={today.data} />}
      </View>
      <View style={{ flexDirection: "row", gap: space(1.5), justifyContent: "center", paddingTop: space(2) }}>
        {qs.map((q) => (
          <View key={q.id} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: answers[q.id]?.sealed ? colors.gold : colors.line }} />
        ))}
      </View>
      <Mono size={9} color={colors.ash} style={{ textAlign: "center", paddingTop: space(2) }}>
        The crowd's leaning is hidden until you commit.
      </Mono>
    </Screen>
  );
}
```

- [ ] **Step 3: Verify + commit**

Root typecheck green; mobile tests green.
```bash
git add apps/mobile/app/round.tsx apps/mobile/src/ui/CrowdReveal.tsx
git commit -m "feat(mobile): round flow with slot progression and live crowd reveal"
```

---

### Task 9: Summons home screen

**Files:**
- Modify: `apps/mobile/app/index.tsx` (replace scaffold screen)

**Interfaces:**
- Consumes: `useToday`, `useRoundStore`.
- Produces: home route with three states: (a) **open round, not fully sealed** → countdown-style card ("THE ORACLE SPEAKS", player_count waiting, boot quote, gold button "ENTER" → `/round`); (b) **fully sealed** → "THE PROPHECY IS SEALED" + button "BEHOLD THE CROWD" → `/round` (which shows CrowdReveal) + "THE LEDGER IS READ AT NOON" + button "YESTERDAY'S LEDGER" → `/reveal/[yesterday]`; (c) **no open round** → "THE ORACLE SLEEPS" + yesterday's ledger button. Yesterday = date-1 of the open round date, else device-local UTC yesterday (`new Date(Date.now() - 86_400_000).toISOString().slice(0,10)`).

- [ ] **Step 1: Implement**

`app/index.tsx`:
```tsx
import { View } from "react-native";
import { Link } from "expo-router";
import { Screen } from "../src/ui/Screen";
import { Serif, Mono, Eyebrow } from "../src/ui/Text";
import { GoldButton } from "../src/ui/Button";
import { useToday } from "../src/api/hooks";
import { useRoundStore } from "../src/game/roundStore";
import { colors, space } from "../src/theme";
import { useRouter } from "expo-router";

const QUOTE = `"It's tough to make predictions,\nespecially about the future."`;

function yesterdayOf(date: string | undefined): string {
  const base = date ? new Date(`${date}T00:00:00Z`) : new Date();
  return new Date(base.getTime() - 86_400_000).toISOString().slice(0, 10);
}

export default function Index() {
  const today = useToday();
  const answers = useRoundStore((s) => s.answers);
  const router = useRouter();

  const round = today.data;
  const allSealed = !!round && round.questions.length > 0 && round.questions.every((q) => answers[q.id]?.sealed);
  const yesterday = yesterdayOf(round?.date);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(5) }}>
        <Eyebrow>Oracle OS v1.0</Eyebrow>
        <Serif size={44} style={{ letterSpacing: 12 }}>ORACLE</Serif>
        <Mono size={12} color={colors.boneDim} style={{ textAlign: "center", lineHeight: 20 }}>{QUOTE}</Mono>
        <Mono size={10} color={colors.gold} letterSpacing={3}>— YOGI BERRA</Mono>
        <View style={{ width: "100%", gap: space(3), paddingTop: space(4) }}>
          {round && !allSealed && (
            <>
              <Mono size={11} color={colors.gold} style={{ textAlign: "center" }} letterSpacing={2}>
                {round.player_count > 0 ? `${round.player_count} ORACLES ALREADY WAITING` : "THE ORACLE SPEAKS"}
              </Mono>
              <GoldButton title="ENTER" onPress={() => router.push("/round")} />
            </>
          )}
          {round && allSealed && (
            <>
              <Mono size={11} color={colors.gold} style={{ textAlign: "center" }} letterSpacing={2}>THE PROPHECY IS SEALED</Mono>
              <GoldButton title="BEHOLD THE CROWD" onPress={() => router.push("/round")} />
            </>
          )}
          {!round && !today.isLoading && (
            <Mono size={11} color={colors.ash} style={{ textAlign: "center" }} letterSpacing={2}>THE ORACLE SLEEPS</Mono>
          )}
          <GoldButton title="YESTERDAY'S LEDGER" onPress={() => router.push(`/reveal/${yesterday}`)} />
        </View>
      </View>
    </Screen>
  );
}
```

- [ ] **Step 2: Verify + commit**

Root typecheck green.
```bash
git add apps/mobile/app/index.tsx
git commit -m "feat(mobile): summons home screen with round states"
```

---

### Task 10: Reveal screen (the ledger)

**Files:**
- Create: `apps/mobile/app/reveal/[date].tsx`

**Interfaces:**
- Consumes: `useReveal(date)`.
- Produces: `/reveal/[date]` — pending (409) state: "THE LEDGER IS NOT YET READ"; loaded state: big Serif `+N`/`−N` day points (goldBright if ≥0, oxblood if negative), "✶ FIRST HOUR ORACLE" when every `my` row exists and day includes the bonus is NOT inferable client-side — omit the badge this plan (server doesn't expose the flag in reveal; noted as Plan 3 API nicety), receipt rows (✓ gold / ✗ oxblood / ∅ ash, dashed separators, tabular points), and a bordered Big One block when a question has `slot === 5`: player's call vs crowd %, "AGAINST THE TIDE ×2" when their side < 40 and they won.

- [ ] **Step 1: Implement**

`app/reveal/[date].tsx`:
```tsx
import { View, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "../../src/ui/Screen";
import { Serif, Mono, Eyebrow } from "../../src/ui/Text";
import { useReveal } from "../../src/api/hooks";
import { colors, space } from "../../src/theme";

export default function RevealScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const reveal = useReveal(date ?? null);

  if (reveal.isLoading) return <Screen><Eyebrow>Consulting the void…</Eyebrow></Screen>;
  if (!reveal.data || "pending" in reveal.data) {
    return <Screen><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <Eyebrow>Day {date}</Eyebrow>
      <Serif size={22} style={{ textAlign: "center" }}>The ledger is not yet read.</Serif>
      <Mono size={11} color={colors.ash} style={{ textAlign: "center" }}>Return at noon.</Mono>
    </View></Screen>;
  }

  const d = reveal.data;
  const big = d.questions.find((q) => q.slot === 5);
  const pos = d.day_points >= 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: space(4), paddingBottom: space(6) }}>
        <Eyebrow>Day {d.date} · the ledger is read</Eyebrow>
        <View style={{ alignItems: "center", gap: space(1) }}>
          <Serif size={54} color={pos ? colors.goldBright : colors.oxblood}>{pos ? `+${d.day_points}` : String(d.day_points)}</Serif>
          <Mono size={9} color={colors.ash} letterSpacing={5}>DAY POINTS</Mono>
        </View>
        <View>
          {d.questions.filter((q) => q.slot !== 5).map((q) => {
            const won = q.my && q.outcome !== "void" && q.my.points !== null && q.my.points > 0;
            const mark = q.outcome === "void" ? "∅" : won ? "✓" : q.my ? "✗" : "·";
            const color = q.outcome === "void" ? colors.ash : won ? colors.gold : q.my ? colors.oxblood : colors.ash;
            return (
              <View key={q.id} style={{ flexDirection: "row", gap: space(2), paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: "rgba(233,225,205,0.08)", alignItems: "baseline" }}>
                <Mono size={12} color={color}>{mark}</Mono>
                <Mono size={11} color={colors.boneDim} style={{ flex: 1 }} numberOfLines={1}>{q.text}</Mono>
                <Mono size={12} color={color}>{q.my?.points != null ? (q.my.points > 0 ? `+${q.my.points}` : String(q.my.points)) : "—"}</Mono>
              </View>
            );
          })}
        </View>
        {big && (
          <View style={{ borderWidth: 1, borderColor: colors.gold, padding: space(3), gap: space(2), backgroundColor: "rgba(201,162,75,0.06)" }}>
            <Mono size={9} color={colors.gold} letterSpacing={4}>✶ THE BIG ONE</Mono>
            <Serif size={17}>{big.text}</Serif>
            {big.my && big.crowd_yes_pct !== null && (() => {
              const sidePct = big.my.answer ? big.crowd_yes_pct : 100 - big.crowd_yes_pct;
              const contrarianWin = sidePct < 40 && (big.my.points ?? 0) > 0;
              return (
                <View style={{ gap: space(1) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Mono size={11}>YOU: {big.my.answer ? "YES" : "NO"} @ {big.my.confidence}%</Mono>
                    <Mono size={11} color={(big.my.points ?? 0) >= 0 ? colors.goldBright : colors.oxblood}>
                      {(big.my.points ?? 0) > 0 ? `+${big.my.points}` : String(big.my.points ?? "—")}
                    </Mono>
                  </View>
                  <Mono size={10} color={colors.ash}>CROWD SAID {big.crowd_yes_pct}% YES{contrarianWin ? " · AGAINST THE TIDE ×2" : ""}</Mono>
                </View>
              );
            })()}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
```

- [ ] **Step 2: Verify + commit**

Root typecheck green.
```bash
git add apps/mobile/app/reveal
git commit -m "feat(mobile): reveal ledger screen with big one block"
```

---

### Task 11: Live run-through against the local API

**Files:**
- Modify: whatever the run-through breaks (fix pass — keep fixes minimal and committed separately with clear messages)

**Interfaces:**
- Consumes: everything.
- Produces: evidence the loop works on a simulator: launch `wrangler dev` (apps/api, `.dev.vars` present) + `npx expo start --ios` (or web fallback `--web` if no simulator available), play a full round (5 seals), see the crowd reveal populate, resolve via admin curl, view `/reveal/[date]`. Capture at least one screenshot per screen (summons, question, crowd, ledger) into `docs/superpowers/plans/assets/plan2-runthrough/`.

- [ ] **Step 1:** Start API + seed a fresh round dated today (reuse the Plan-1 demo SQL pattern; questions open now, lock +24h).
- [ ] **Step 2:** `pnpm --filter @oracle/mobile exec npx expo start --ios` — walk the loop; fix and commit anything broken (`fix(mobile): …`).
- [ ] **Step 3:** Screenshots into the assets dir; commit.
- [ ] **Step 4:** Full `pnpm typecheck && pnpm test` green; commit any final fixes.

```bash
git add -A && git commit -m "chore(mobile): plan-2 run-through evidence and fixes"
```

---

## Deferred (explicit)

Plan 3: fonts (licensed Arizona/Marcellus+Cinzel via expo-font), Skia (grain/gold shaders, share cards), streak surfaces + `GET /v1/me`, RevenueCat + paywall, OneSignal, PostHog, Sentry, account merge (Clerk), EAS build profiles + dev client, App Review submission, first-hour badge exposure in the reveal API. Plan 4: DO live counter/SSE (crowd polling → push), drop/lock automation, Hermes agent, admin UI, leaderboard/titles, marketing site.

## Self-review notes

- Spoiler wall: crowd data flows only through `/today/crowd` (server filters to sealed) and `CrowdReveal` filters to sealed ids client-side; predict screens never query crowd. ✓
- Type consistency: `RoundToday`/`Reveal`/`CrowdSoFar` defined in core Task 3/5, consumed Tasks 5–10 by those names; `useRoundStore` shape defined Task 7 and consumed in 8–9 as written. `ApiError` defined Task 4, used Task 7. ✓
- Placeholders: none; every task carries complete code. Task 11 is deliberately a run-through/fix task with evidence artifacts, not code-from-plan.
