# Refinement Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise Reveal, Rites, Plus, Summons, CrowdReveal and the Ledger to the standard Home and the Card already set, and give the Card the machine information it is missing, so every frame of the app reads as one designed object.

**Architecture:** All new decision logic lands in `apps/mobile/src/game/*.ts` as pure, RN-free modules with vitest coverage (the repo's established pattern — vitest cannot import `.tsx`). Components consume those modules and are verified by `pnpm typecheck` plus manual run. No component test framework is introduced. Presentation changes reuse existing primitives (`CardChrome`, `GoldFrame`, `Mono`/`Serif`/`Ritual`, `GoldButton`/`QuietLink`) rather than adding new ones, except for one new `RiteConfirm` surface.

**Tech Stack:** Expo SDK 57, React Native 0.86, expo-router, react-native-reanimated 4.5, @shopify/react-native-skia 2.6, vitest 4, TypeScript 6, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-01-refinement-pass-design.md`

## Global Constraints

- **Expo docs:** Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code (repo `AGENTS.md`).
- **Brand brief is authoritative:** `docs/superpowers/specs/2026-08-26-oracle-brand-brief.md`. Museum-white ground, ink type, very restrained borders, ASCII as a discovered detail. No terminal green, no neon, no glassmorphism, no gradient text.
- **Palette:** only tokens from `apps/mobile/src/theme.ts`. Never introduce a raw hex at a call site.
- **Two voices:** machine voice (`Mono`, IBM Plex Mono) owns all chrome. Temple voice (`Ritual`/Cinzel, `Serif`/Marcellus) is reserved for the wordmark, card numerals, day points, question text, and the card/share artifacts. Do not widen this.
- **Reduced motion:** every animation must check `useReducedMotion()` and degrade to a static or instant state.
- **Accessibility:** ASCII and colour never carry meaning alone (brief §11). Touch targets ≥44pt. Nothing below 10px that a user is expected to read.
- **Pure logic in `src/game/*.ts`,** no `react-native` imports in any file under test. Tests live in `apps/mobile/test/*.test.ts`.
- **Verification commands** (run from `apps/mobile`): `pnpm test`, `pnpm typecheck`. Both must pass before every commit.
- **Working branch:** `design/refinement-pass`. Commit after every task.

---

### Task 1: Card status field, glyph register marks, bracketed title

**Files:**
- Create: `apps/mobile/src/game/cardStatus.ts`
- Create: `apps/mobile/test/cardStatus.test.ts`
- Modify: `apps/mobile/src/theme.ts` (add one colour token)
- Modify: `apps/mobile/src/ui/CardChrome.tsx` (full rework of `RegisterMarks` and the header/footer)
- Modify: `apps/mobile/src/ui/OracleCard.tsx:~370-400` (title/modifier split, pass `status`)
- Modify: `apps/mobile/src/ui/UndealtCard.tsx` (`STACK_TOP_Y`, title/modifier split)

**Interfaces:**
- Consumes: `msUntil`, `formatCountdown` from `src/game/countdown.ts`; `useNow` from `src/game/useNow.ts`; `numeral` from `src/game/numerals.ts`.
- Produces: `cardStatus(locksAt: string | null, now: number, sealed: boolean): string`. `CardChrome` gains props `modifiers?: string` and `status?: string`; its `title` prop is now the category alone.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/cardStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cardStatus } from "../src/game/cardStatus";

const NOW = Date.parse("2026-09-01T12:00:00Z");

describe("cardStatus", () => {
  it("reports a sealed card regardless of the clock", () => {
    expect(cardStatus("2026-09-01T16:12:09Z", NOW, true)).toBe("ST: SEALED");
    expect(cardStatus(null, NOW, true)).toBe("ST: SEALED");
  });

  it("counts down to the lock while the card is open", () => {
    expect(cardStatus("2026-09-01T16:12:09Z", NOW, false)).toBe("LOCK 4:12:09");
  });

  it("drops the hour segment inside the last hour", () => {
    expect(cardStatus("2026-09-01T12:04:30Z", NOW, false)).toBe("LOCK 04:30");
  });

  it("reads OPEN when there is no lock to count down to", () => {
    expect(cardStatus(null, NOW, false)).toBe("ST: OPEN");
  });

  it("reads OPEN once the lock has passed, never a negative countdown", () => {
    expect(cardStatus("2026-09-01T11:59:00Z", NOW, false)).toBe("ST: OPEN");
  });

  it("reads OPEN on an unparseable timestamp rather than throwing", () => {
    expect(cardStatus("not-a-date", NOW, false)).toBe("ST: OPEN");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/mobile`: `pnpm vitest run test/cardStatus.test.ts`
Expected: FAIL — `Failed to resolve import "../src/game/cardStatus"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/mobile/src/game/cardStatus.ts`:

```ts
import { formatCountdown, msUntil } from "./countdown";

// The card's one live field (refinement spec §1.2). The countdown lived only
// on Home, so the card never said it was ticking — a still frame of it read
// as an inert object. Machine voice: this is chrome, not scripture.
export function cardStatus(locksAt: string | null, now: number, sealed: boolean): string {
  if (sealed) return "ST: SEALED";
  const ms = msUntil(locksAt, now);
  // msUntil already returns null for a null, unparseable, or elapsed lock.
  return ms === null ? "ST: OPEN" : `LOCK ${formatCountdown(ms)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/cardStatus.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the register-mark colour token**

In `apps/mobile/src/theme.ts`, inside the `colors` object, directly after the `lineSoft` entry, add:

```ts
  mark: "rgba(23,25,31,0.30)", // register marks — a glyph reads lighter than a rule, so it sits a step above `line`
```

- [ ] **Step 6: Rework `CardChrome`**

Replace the whole of `apps/mobile/src/ui/CardChrome.tsx` with:

```tsx
import { View } from "react-native";
import { colors, space } from "../theme";
import { Ritual, Mono, Eyebrow } from "./Text";
import { NUMERALS, numeral } from "../game/numerals";

export { NUMERALS, numeral };

// Tarot proportion (brief §3: "large areas of quiet negative space are
// essential") — the card is an object you drew, not a form you fill.
const DECK_RATIO = 0.7;

const INSET = 9;
const MARK_BOX = 14; // the glyph's centring box, straddling the rule's corner

// Register marks: the frame's corners, drawn as the machine's own '+' rather
// than as rectangles (refinement spec §1.1). Same silhouette as the antique
// card-printing / technical-drawing mark they replace, but now the frame is
// type — it belongs to the same alphabet as the coordinate and the status.
function RegisterMarks() {
  const corners = [
    { top: INSET - MARK_BOX / 2, left: INSET - MARK_BOX / 2 },
    { top: INSET - MARK_BOX / 2, right: INSET - MARK_BOX / 2 },
    { bottom: INSET - MARK_BOX / 2, left: INSET - MARK_BOX / 2 },
    { bottom: INSET - MARK_BOX / 2, right: INSET - MARK_BOX / 2 },
  ];
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", top: INSET, bottom: INSET, left: INSET, right: INSET, borderWidth: 1, borderColor: colors.lineSoft }} />
      {corners.map((c, i) => (
        <View key={i} pointerEvents="none" style={{ position: "absolute", ...c, width: MARK_BOX, height: MARK_BOX, alignItems: "center", justifyContent: "center" }}>
          <Mono size={11} color={colors.mark} letterSpacing={0} style={{ lineHeight: MARK_BOX }}>+</Mono>
        </View>
      ))}
    </>
  );
}

// The card's terminal margin (brief §8: "a feature card reveals a static
// terminal coordinate or symbol cluster"). Two quiet mono fields, optically
// symmetric: provenance on the left, live state on the right.
export function CardChrome({ slot, title, modifiers, coordinate, status, big = false, fill = false, children }: {
  slot: number;
  // The category alone. Modifiers ride their own line — a single long title
  // wrapped badly at the eyebrow's tracking.
  title: string;
  modifiers?: string;
  coordinate?: string;
  status?: string;
  big?: boolean;
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: big ? colors.agedGold : colors.line,
        backgroundColor: colors.frescoWhite,
        paddingHorizontal: space(6),
        paddingTop: space(6),
        paddingBottom: space(9),
        ...(fill ? { flex: 1 } : { aspectRatio: DECK_RATIO }),
      }}
    >
      <RegisterMarks />
      <View style={{ alignItems: "center", gap: space(2) }}>
        <Ritual bold size={18} color={colors.goldText} letterSpacing={5} style={{ marginRight: -5 }}>{numeral(slot)}</Ritual>
        {/* Brackets are the app's terminal signature (they frame the footer
            rail's controls). On an undealt card the contents are static and
            the brackets stay solid — the frame is known, the prophecy is not. */}
        <Eyebrow>{`[ ${title} ]`}</Eyebrow>
        {modifiers ? (
          <Mono size={9.5} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>{modifiers}</Mono>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: space(3), paddingTop: space(3) }}>{children}</View>
      {coordinate ? (
        <Mono size={8.5} color={colors.mutedInk} letterSpacing={1.5} style={{ position: "absolute", left: INSET + 11, bottom: INSET + 8 }}>
          {coordinate}
        </Mono>
      ) : null}
      {status ? (
        <Mono size={8.5} color={colors.mutedInk} letterSpacing={1.5} style={{ position: "absolute", right: INSET + 11, bottom: INSET + 8 }}>
          {status}
        </Mono>
      ) : null}
    </View>
  );
}
```

Note: `size={8.5}` on the two margin fields is corrected to 10 in Task 5; leave it at 8.5 here so this task changes one thing at a time.

- [ ] **Step 7: Split the title and feed the status in `OracleCard`**

In `apps/mobile/src/ui/OracleCard.tsx`:

Add to the imports at the top of the file:

```tsx
import { cardStatus } from "../game/cardStatus";
import { useNow } from "../game/useNow";
```

Add inside the `OracleCard` component body, immediately after the `const screenReader = useScreenReader();` line:

```tsx
  // The status field ticks at the countdown's cadence; the card is on screen
  // for at most a few minutes, so a 1s interval here is cheap.
  const now = useNow(1000);
```

Replace the existing title block (the `const closesEarly = ...` / `const title = q.is_big_one ? ... : q.category;` statements) with:

```tsx
  const closesEarly = roundLocksAt !== null && q.locks_at !== roundLocksAt;
  const title = q.is_big_one ? "✶ THE BIG ONE" : q.category;
  const modifiers = [
    q.is_big_one ? "PAYS DOUBLE · COSTS DOUBLE" : null,
    closesEarly ? "CLOSES EARLY" : null,
  ].filter(Boolean).join(" · ");
```

Replace the `<CardChrome ...>` opening tag with:

```tsx
        <CardChrome
          slot={q.slot}
          title={title}
          modifiers={modifiers || undefined}
          big={q.is_big_one}
          coordinate={`:: ${numeral(q.slot)} / ${date} / PER ${q.source_name.toUpperCase()}`}
          status={cardStatus(q.locks_at, now, sealed)}
        >
```

- [ ] **Step 8: Show the stack's static and split its title**

In `apps/mobile/src/ui/UndealtCard.tsx`:

Change the resting offset so the deck's static is visible at rest (spec §1.4):

```tsx
export const STACK_TOP_Y = 16;
```

and change the two `top` / `transform` offsets in the wrapping `View` style from `STACK_TOP_Y + index * 9` to `STACK_TOP_Y + index * 14`.

The `CardChrome` call needs no `modifiers` or `status` — an undealt card is not ticking and its modifiers are not yet knowable. Leave it as `<CardChrome slot={q.slot} title={decodeFrame(q.category, 0, 1, q.id)} big={q.is_big_one}>`.

- [ ] **Step 9: Verify**

Run from `apps/mobile`:
```bash
pnpm test
pnpm typecheck
```
Expected: all tests pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/game/cardStatus.ts apps/mobile/test/cardStatus.test.ts apps/mobile/src/theme.ts apps/mobile/src/ui/CardChrome.tsx apps/mobile/src/ui/OracleCard.tsx apps/mobile/src/ui/UndealtCard.tsx
git commit -m "feat(mobile): the card states its own hour, and its frame joins the alphabet"
```

---

### Task 2: The reveal ledger speaks in the card's vocabulary

**Files:**
- Modify: `apps/mobile/src/app/reveal/[date].tsx:160-176` (the ordinary-row block)

**Interfaces:**
- Consumes: `rowState`, `rowMark`, `rowRight`, `receiptLine` from `src/game/revealRows.ts` (all unchanged); `numeral` from `src/ui/CardChrome`; `Serif`, `Mono`, `Ritual` from `src/ui/Text`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the numeral import**

In `apps/mobile/src/app/reveal/[date].tsx`, add to the imports:

```tsx
import { numeral } from "../../ui/CardChrome";
```

- [ ] **Step 2: Replace the ordinary-row block**

Replace the `<View>` wrapping `d.questions.filter((q) => q.slot !== 5).map(...)` — currently lines 160–176 — with:

```tsx
        {/* The day's four ordinary calls, in the card's vocabulary rather
            than a settings list (refinement spec §2): the slot numeral is
            the anchor, the prophecy keeps the temple voice it was asked in,
            and the receipt drops to machine voice underneath it. One rule
            closes the group instead of four rules boxing every row. */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
          {d.questions.filter((q) => q.slot !== 5).map((q, i) => {
            const st = rowState(q);
            const color = st === "win" ? colors.goldText : st === "loss" ? colors.vermilion : colors.mutedInk;
            const receipt = receiptLine(q);
            return (
              <Animated.View
                key={q.id}
                entering={FadeInDown.delay(ROW_DELAY + i * ROW_STAGGER).duration(400).easing(easeOut)}
                style={{ flexDirection: "row", gap: space(3), paddingVertical: space(3), alignItems: "flex-start" }}
              >
                <Ritual size={13} color={color} letterSpacing={1} style={{ width: 22, textAlign: "center" }}>
                  {numeral(q.slot)}
                </Ritual>
                <View style={{ flex: 1, gap: space(1) }}>
                  <Serif size={15} color={colors.ink} numberOfLines={3} style={{ lineHeight: 21 }}>{q.text}</Serif>
                  {receipt ? (
                    <Mono size={10} color={colors.mutedInk} numberOfLines={2} style={{ lineHeight: 15 }}>{receipt}</Mono>
                  ) : null}
                </View>
                {/* The mark rides with the value: outcome must never be
                    carried by colour alone (brief §11). */}
                <Mono size={12} color={color} letterSpacing={1}>{`${rowMark(st)} ${rowRight(q)}`}</Mono>
              </Animated.View>
            );
          })}
        </View>
```

- [ ] **Step 3: Verify**

Run from `apps/mobile`: `pnpm typecheck`
Expected: no errors. (`rowMark` is still imported and now used here; confirm no unused-import lint error with `pnpm lint`.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/reveal/\[date\].tsx
git commit -m "feat(mobile): the day's ledger is read as an artifact, not a table"
```

---

### Task 3: The Rite of confirmation replaces both system alerts

**Files:**
- Create: `apps/mobile/src/ui/RiteConfirm.tsx`
- Modify: `apps/mobile/src/app/ledger.tsx` (remove `Alert` import and both `Alert.alert` calls)

**Interfaces:**
- Consumes: `GoldButton`, `QuietLink` from `src/ui/Button`; `Mono`, `Ritual` from `src/ui/Text`; `colors`, `space` from `src/theme`.
- Produces: `RiteConfirm` — `{ visible: boolean; title: string; body?: string; confirmLabel: string; destructive?: boolean; onConfirm: () => void; onWithdraw: () => void }`.

- [ ] **Step 1: Create the surface**

Create `apps/mobile/src/ui/RiteConfirm.tsx`:

```tsx
import { View, Pressable, StyleSheet } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { colors, space } from "../theme";
import { Mono, Ritual } from "./Text";
import { GoldButton, QuietLink } from "./Button";

// The app asked its two most dramatic questions — striking the record, and a
// collided identity — through Alert.alert: SF Pro in a rounded system dialog,
// buttons reading CANCEL and STRIKE. It was the loudest tonal break in the
// app (refinement spec §3). A consequence this heavy deserves the app's own
// ceremony: museum ground, a framed panel, the machine's voice.
//
// The scrim is pressable and withdraws — the safe outcome is always the easy
// one; only the framed button commits.
export function RiteConfirm({ visible, title, body, confirmLabel, destructive = false, onConfirm, onWithdraw }: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onWithdraw: () => void;
}) {
  const reducedMotion = useReducedMotion();
  if (!visible) return null;
  const tone = destructive ? colors.vermilion : colors.agedGold;
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(180)}
      style={[StyleSheet.absoluteFill, { zIndex: 200, justifyContent: "center", padding: space(6) }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Withdraw"
        onPress={onWithdraw}
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite, opacity: 0.96 }]}
      />
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: tone, padding: space(5), gap: space(4) }}
      >
        <Ritual bold size={16} color={colors.ink} letterSpacing={3} style={{ textAlign: "center" }}>{title}</Ritual>
        {body ? (
          <Mono size={11} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center", lineHeight: 18 }}>{body}</Mono>
        ) : null}
        <View style={{ gap: space(2) }}>
          <GoldButton title={confirmLabel} onPress={onConfirm} />
          <QuietLink title="Withdraw" onPress={onWithdraw} />
        </View>
      </View>
    </Animated.View>
  );
}
```

- [ ] **Step 2: Replace both alerts in the ledger**

In `apps/mobile/src/app/ledger.tsx`:

Change the react-native import from `import { View, Alert } from "react-native";` to `import { View } from "react-native";`, and add:

```tsx
import { RiteConfirm } from "../ui/RiteConfirm";
```

Add this state declaration next to the other `useState` calls in the component body:

```tsx
  // Which rite is being asked, if any. Only one can be open at a time.
  const [rite, setRite] = useState<"collision" | "strike" | null>(null);
```

Replace `handleClaim` and `handleStrike` with:

```tsx
  const handleClaim = () => {
    void (async () => {
      const result = await appleClaim();
      if (result === "claimed") qc.invalidateQueries({ queryKey: ["me", "ledger"] });
      else if (result === "collision") setRite("collision");
    })();
  };

  const confirmRestore = () => {
    setRite(null);
    void (async () => {
      const r = await appleRestore();
      if (r === "restored") {
        qc.invalidateQueries();
        router.replace("/");
      }
    })();
  };

  const confirmStrike = () => {
    setRite(null);
    void (async () => {
      const ok = await strikeRecord();
      if (ok) router.replace("/");
    })();
  };
```

Change the strike `QuietLink`'s handler from `onPress={handleStrike}` to `onPress={() => setRite("strike")}`.

Immediately before the closing `</Screen>` tag, add:

```tsx
      <RiteConfirm
        visible={rite === "collision"}
        title="THE RECORD ALREADY BEARS A NAME"
        body="RESTORE IT, AND THIS DEVICE TAKES UP THE RECORD THAT NAME ALREADY HOLDS."
        confirmLabel="RESTORE THE RECORD"
        onConfirm={confirmRestore}
        onWithdraw={() => setRite(null)}
      />
      <RiteConfirm
        visible={rite === "strike"}
        title="THE RECORD WILL BE STRUCK"
        body="EVERY VIGIL, EVERY CALL, EVERY EPITHET. THIS IS NOT UNDONE."
        confirmLabel="STRIKE THE RECORD"
        destructive
        onConfirm={confirmStrike}
        onWithdraw={() => setRite(null)}
      />
```

- [ ] **Step 3: Verify**

Run from `apps/mobile`:
```bash
pnpm typecheck
grep -rn "Alert" src/app/ledger.tsx
```
Expected: no type errors; the grep returns nothing.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/RiteConfirm.tsx apps/mobile/src/app/ledger.tsx
git commit -m "feat(mobile): the record is struck by rite, not by system alert"
```

---

### Task 4: Type-scaling primitives

**Files:**
- Create: `apps/mobile/src/game/typeScaling.ts`
- Create: `apps/mobile/test/typeScaling.test.ts`
- Modify: `apps/mobile/src/ui/Text.tsx` (add the cap to every chrome component)

**Interfaces:**
- Consumes: nothing.
- Produces: `CHROME_CAP: 1.3`, `cappedScale(fontScale: number, cap?: number): number`, `scaledRow(base: number, fontScale: number, cap?: number): number`. `Text.tsx`'s `Mono`, `Ritual` and `Eyebrow` gain `maxFontSizeMultiplier`; `Serif` scales freely.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/typeScaling.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CHROME_CAP, cappedScale, scaledRow } from "../src/game/typeScaling";

describe("cappedScale", () => {
  it("never shrinks below 1 — chrome does not get smaller than designed", () => {
    expect(cappedScale(0.85)).toBe(1);
    expect(cappedScale(1)).toBe(1);
  });
  it("passes scale through below the cap", () => {
    expect(cappedScale(1.15)).toBeCloseTo(1.15);
  });
  it("clamps at the chrome cap", () => {
    expect(cappedScale(2.4)).toBe(CHROME_CAP);
    expect(cappedScale(3.5)).toBe(CHROME_CAP);
  });
  it("honours an explicit cap", () => {
    expect(cappedScale(2, 1.6)).toBe(1.6);
  });
  it("falls back to 1 on a nonsense scale rather than collapsing the layout", () => {
    expect(cappedScale(Number.NaN)).toBe(1);
    expect(cappedScale(0)).toBe(1);
    expect(cappedScale(Number.POSITIVE_INFINITY)).toBe(CHROME_CAP);
  });
});

describe("scaledRow", () => {
  it("grows a reserved row with the capped scale", () => {
    expect(scaledRow(16, 1.25)).toBe(20);
  });
  it("returns whole pixels — a reserved slot must not land on a subpixel", () => {
    expect(Number.isInteger(scaledRow(14, 1.15))).toBe(true);
  });
  it("leaves a row untouched at default scale", () => {
    expect(scaledRow(16, 1)).toBe(16);
  });
  it("stops growing past the cap", () => {
    expect(scaledRow(20, 3)).toBe(scaledRow(20, CHROME_CAP));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/mobile`: `pnpm vitest run test/typeScaling.test.ts`
Expected: FAIL — `Failed to resolve import "../src/game/typeScaling"`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/game/typeScaling.ts`:

```ts
// Dynamic Type, capped rather than fluid (refinement spec §4). Home's
// no-shift choreography depends on reserved slots being constants known at
// layout time (CALL_SLOT_H, CLOCK_H, ROW_H); letting chrome scale without a
// ceiling would dissolve it. So chrome grows to a ceiling and the reserved
// slots grow with it by exactly the same factor, while the temple voice —
// the question, the prophecy, the content — scales freely.
export const CHROME_CAP = 1.3;

// Clamped to [1, cap]: chrome never renders smaller than it was designed,
// and never larger than the reserved rows can absorb.
export function cappedScale(fontScale: number, cap: number = CHROME_CAP): number {
  if (!Number.isFinite(fontScale)) return fontScale === Number.POSITIVE_INFINITY ? cap : 1;
  if (fontScale <= 0) return 1;
  return Math.min(Math.max(fontScale, 1), cap);
}

// A reserved row's height at the current scale. Whole pixels — a slot that
// lands on a subpixel is a hairline of drift on every row beneath it.
export function scaledRow(base: number, fontScale: number, cap: number = CHROME_CAP): number {
  return Math.ceil(base * cappedScale(fontScale, cap));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run test/typeScaling.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Apply the cap in `Text.tsx`**

In `apps/mobile/src/ui/Text.tsx`, add the import:

```tsx
import { CHROME_CAP } from "../game/typeScaling";
```

Add `maxFontSizeMultiplier={CHROME_CAP}` to the `<Text>` returned by `Ritual` and by `Mono` (before `{...rest}` so a caller can still override it). Leave `Serif` uncapped — it renders the question and the prophecy, which are content and must scale freely. `Eyebrow` inherits the cap through `Mono`.

The two components become:

```tsx
export function Ritual({ size = 14, color = colors.goldText, bold = false, letterSpacing = 3, style, ...rest }: TextProps & { size?: number; color?: string; bold?: boolean; letterSpacing?: number }) {
  return <Text maxFontSizeMultiplier={CHROME_CAP} {...rest} style={[{ fontFamily: bold ? fonts.ritualBold : fonts.ritual, fontSize: size, color, letterSpacing }, style]} />;
}

export function Mono({ size = 13, color = colors.mutedInk, letterSpacing = 0.5, style, ...rest }: TextProps & { size?: number; color?: string; letterSpacing?: number }) {
  return <Text maxFontSizeMultiplier={CHROME_CAP} {...rest} style={[{ fontFamily: fonts.mono, fontSize: size, color, letterSpacing }, style]} />;
}
```

- [ ] **Step 6: Verify**

Run from `apps/mobile`: `pnpm test && pnpm typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/typeScaling.ts apps/mobile/test/typeScaling.test.ts apps/mobile/src/ui/Text.tsx
git commit -m "feat(mobile): chrome scales to a ceiling, content scales freely"
```

---

### Task 5: Reserved slots grow with the type, and nothing reads below 10px

**Files:**
- Create: `apps/mobile/src/ui/useChromeScale.ts`
- Modify: `apps/mobile/src/app/index.tsx` (`CALL_SLOT_H`, `StateRow`, notice slot)
- Modify: `apps/mobile/src/ui/OracleClock.tsx` (`CLOCK_H`)
- Modify: `apps/mobile/src/app/round.tsx` (the fixed `height: 40` footer slot)
- Modify: `apps/mobile/src/ui/CardChrome.tsx` (margin fields 8.5 → 10)
- Modify: `apps/mobile/src/app/reveal/[date].tsx`, `apps/mobile/src/app/ledger.tsx`, `apps/mobile/src/app/rites.tsx`, `apps/mobile/src/app/plus.tsx` (size 9/9.5 → 10). `round.tsx` also carries two `size={9}` lines — sweep them in the same pass.
- Do **not** modify: `apps/mobile/src/ui/ConvictionColumn.tsx` (its `size={8}` values are gauge tick labels, not reading text — see Step 5); `apps/mobile/src/ui/CrowdReveal.tsx` (nothing below 10px there); `apps/mobile/src/ui/ConfidenceSlider.tsx` (dead file, imported by nothing)

**Interfaces:**
- Consumes: `scaledRow`, `CHROME_CAP` from `src/game/typeScaling.ts`.
- Produces: `useChromeScale(): number` — the current capped font scale, for sizing reserved slots.

- [ ] **Step 1: Create the hook**

Create `apps/mobile/src/ui/useChromeScale.ts`:

```ts
import { useWindowDimensions, PixelRatio } from "react-native";
import { cappedScale } from "../game/typeScaling";

// The capped font scale, re-read when the window changes. useWindowDimensions
// re-renders on the OS text-size change that also changes getFontScale(), so
// a reserved slot sized from this stays correct without its own listener.
export function useChromeScale(): number {
  useWindowDimensions();
  return cappedScale(PixelRatio.getFontScale());
}
```

- [ ] **Step 2: Grow Home's reserved slots**

In `apps/mobile/src/app/index.tsx`:

Add imports:

```tsx
import { useChromeScale } from "../ui/useChromeScale";
import { scaledRow } from "../game/typeScaling";
```

Delete the module-level `const CALL_SLOT_H = ROW_H.line * 2 + space(3) + 48;` and its comment block, and delete the `StateRow` function. Replace both with a comment noting they are now computed per-render (the reserved heights must follow the OS text size):

```tsx
// The call's reserved height: two rows of state line and the framed action.
// Home used to be a plain column, so every query that resolved — the round,
// the ledger, yesterday's reveal — changed the bottom stack's height and
// shoved the hero, wordmark and epigraph up the screen. The slot is this tall
// from the first frame and its contents bottom-align inside it. It scales
// with the OS text size, because the rows inside it do (spec §4).
function callSlotHeight(scale: number) {
  return scaledRow(ROW_H.line, scale) * 2 + space(3) + Math.ceil(48 * scale);
}
```

Inside the `Index` component, immediately after `const router = useRouter();`, add:

```tsx
  const chromeScale = useChromeScale();
  const stateRowH = scaledRow(ROW_H.line, chromeScale) * 2;
  const noticeRowH = scaledRow(ROW_H.meta, chromeScale);
```

Replace every `<StateRow>` … `</StateRow>` wrapper (there are three) with:

```tsx
              <View style={{ minHeight: stateRowH, justifyContent: "flex-end" }}>
                …existing children unchanged…
              </View>
```

Change `<View style={{ minHeight: CALL_SLOT_H, justifyContent: "flex-end", gap: space(3) }}>` to `<View style={{ minHeight: callSlotHeight(chromeScale), justifyContent: "flex-end", gap: space(3) }}>`.

Change the notice slot `<View style={{ minHeight: ROW_H.meta, justifyContent: "center" }}>` to `<View style={{ minHeight: noticeRowH, justifyContent: "center" }}>`.

- [ ] **Step 3: Grow the clock's slot**

In `apps/mobile/src/ui/OracleClock.tsx`, add:

```tsx
import { useChromeScale } from "./useChromeScale";
import { scaledRow } from "../game/typeScaling";
```

Delete the module-level `const CLOCK_H = ROW_H.meta + space(1) + ROW_H.clock;`. Inside the component, after `const now = useNow(1000);`, add:

```tsx
  const scale = useChromeScale();
  const clockH = scaledRow(ROW_H.meta, scale) + space(1) + scaledRow(ROW_H.clock, scale);
```

and change the wrapping `<View style={{ height: CLOCK_H, ... }}>` to use `clockH`.

- [ ] **Step 4: Grow the round's footer slot**

In `apps/mobile/src/app/round.tsx`, add the same two imports (`useChromeScale` from `../ui/useChromeScale`, `scaledRow` from `../game/typeScaling`), add `const chromeScale = useChromeScale();` next to the other hooks at the top of the component (it must sit above the early `return`s for loading and empty states), and change the footer slot `<View style={{ height: 40, justifyContent: "center" }}>` to:

```tsx
      <View style={{ height: scaledRow(40, chromeScale), justifyContent: "center" }}>
```

- [ ] **Step 5: Raise every sub-10px reading size to 10**

Apply this edit everywhere a `Mono` renders text a user is expected to read. Verify the full list first:

```bash
cd apps/mobile && grep -rn "size={8\(\.5\)\?}\|size={9\(\.5\)\?}" src/
```

Change each hit to `size={10}`, with these two exceptions which are **glyph instruments, not reading text** and stay as they are:
- `src/ui/ConvictionColumn.tsx` — the `95` and `55` scale endpoints at `size={8}`; they are tick labels on a gauge whose value is stated at `size={14}` directly above.

`src/ui/ConfidenceSlider.tsx` is imported by nothing — leave it alone.

For `src/ui/CardChrome.tsx`, the coordinate and status fields go from `size={8.5}` to `size={10}` and their `letterSpacing` drops from `1.5` to `1` so the longer coordinate string still fits the card's width.

- [ ] **Step 6: Verify**

Run from `apps/mobile`:
```bash
pnpm test && pnpm typecheck
grep -rn "CALL_SLOT_H\|CLOCK_H\|StateRow" src/
```
Expected: tests pass, no type errors, and the grep returns nothing (all three symbols are gone).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/ui/useChromeScale.ts apps/mobile/src/app/index.tsx apps/mobile/src/ui/OracleClock.tsx apps/mobile/src/app/round.tsx apps/mobile/src/ui/CardChrome.tsx apps/mobile/src/app/reveal/\[date\].tsx apps/mobile/src/app/ledger.tsx apps/mobile/src/app/rites.tsx apps/mobile/src/app/plus.tsx
git commit -m "feat(mobile): reserved slots follow the reader's text size"
```

---

### Task 6: The crowd is revealed inside a frame

**Files:**
- Modify: `apps/mobile/src/ui/CrowdReveal.tsx:52-80` (the `CrowdReveal` body only; `CrowdBar` is unchanged)

**Interfaces:**
- Consumes: `GoldFrame` from `src/ui/GoldFrame`; existing `CrowdBar`, `Serif`, `Mono`, `Eyebrow`, `GoldButton`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the frame import**

In `apps/mobile/src/ui/CrowdReveal.tsx`:

```tsx
import { GoldFrame } from "./GoldFrame";
```

- [ ] **Step 2: Frame the revelation**

Replace the `<View style={{ gap: space(4), flex: 1 }}>` block that maps `sealed` — and the two `Mono` summary lines directly beneath it — with:

```tsx
      {/* The round's second artifact (refinement spec §5). It followed a
          gilded card and arrived as an unframed list; the gold-leaf frame
          says this is the same document, now countersigned by the crowd. */}
      <GoldFrame style={{ flex: 1, backgroundColor: colors.frescoWhite }}>
        <View style={{ flex: 1, padding: space(4), gap: space(4) }}>
          {sealed.map((q) => {
            const c = byId.get(q.id)!;
            const mine = answers[q.id]!;
            const mySidePct = mine.answer ? c.crowd_yes_pct : 100 - c.crowd_yes_pct;
            const against = contrarianApplies(mySidePct, c.player_count);
            return (
              <View key={q.id} style={{ gap: space(1.5) }}>
                <Serif size={15} color={colors.ink} numberOfLines={2}>{q.text}</Serif>
                <CrowdBar pct={c.crowd_yes_pct} />
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Mono size={10} color={colors.goldText}>{c.crowd_yes_pct}% SAY YES</Mono>
                  <Mono size={10} color={against ? colors.goldText : colors.mutedInk}>
                    {mine.answer ? "YOU: YES" : "YOU: NO"} @ {mine.confidence}%{against ? " · AGAINST THE TIDE" : ""}
                  </Mono>
                </View>
              </View>
            );
          })}
          <View style={{ flex: 1 }} />
          <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.4 }} />
          <View style={{ gap: space(1) }}>
            <Mono size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2}>
              {playerCount === 1 ? "1 ORACLE HAS SPOKEN" : `${playerCount} ORACLES HAVE SPOKEN`}
            </Mono>
            <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={1}>
              THE LEDGER IS READ TOMORROW AT NOON
            </Mono>
          </View>
        </View>
      </GoldFrame>
```

Note the question text moves from `colors.mutedInk` to `colors.ink` — inside the frame it is the content, not a caption — and the closing line moves to machine voice and caps, matching every other system line in the app.

- [ ] **Step 3: Verify**

Run from `apps/mobile`: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/CrowdReveal.tsx
git commit -m "feat(mobile): the crowd's verdict is countersigned in gold leaf"
```

---

### Task 7: The Rites become a numbered liturgy

**Files:**
- Modify: `apps/mobile/src/app/rites.tsx:19-31`

**Interfaces:**
- Consumes: `RITES_LINES`, `LITURGY_LINES` from `@oracle/core`; `Ritual` from `src/ui/Text`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the copy you are numbering**

Run from the repo root:
```bash
grep -rn "RITES_LINES" packages/core/src | head
```
Read the array. If it holds more than five entries, the numerals must fall back to arabic past `V` — `numeral()` already does this (`numerals.ts` returns `String(slot)` past the fifth), so use it rather than indexing `NUMERALS` directly.

- [ ] **Step 2: Number the rules**

In `apps/mobile/src/app/rites.tsx`, add the imports:

```tsx
import { Ritual } from "../ui/Text";
import { numeral } from "../ui/CardChrome";
```

Replace the `<View style={{ gap: space(2) }}>` block that maps `RITES_LINES` with:

```tsx
        {/* These are rules, so they are numbered — in the same carved
            numerals the card slots and the round's progress row use, so a
            rite and a call are visibly the same kind of thing (spec §6).
            Left-aligned: a numbered list that is centred is a poem. */}
        <View style={{ gap: space(3) }}>
          {RITES_LINES.map((line, i) => (
            <View key={line} style={{ flexDirection: "row", gap: space(3), alignItems: "flex-start" }}>
              <Ritual size={13} color={colors.goldText} letterSpacing={1} style={{ width: 26, textAlign: "right" }}>
                {numeral(i + 1)}
              </Ritual>
              <DecodeLine
                text={line}
                delayMs={i * 130}
                durationMs={450}
                size={11}
                color={colors.ink}
                letterSpacing={2}
                style={{ flex: 1, lineHeight: 18 }}
              />
            </View>
          ))}
        </View>
```

- [ ] **Step 3: Verify**

Run from `apps/mobile`: `pnpm typecheck`
Expected: no errors. Confirm `DecodeLine` accepts a `style` with `flex: 1` — check its prop type in `src/ui/DecodeText.tsx` and, if it narrows `style` to a non-flex type, widen it to `StyleProp<TextStyle>`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/rites.tsx
git commit -m "feat(mobile): the rites are numbered in the card's own numerals"
```

---

### Task 8: Plus leads with the comparison

**Files:**
- Modify: `apps/mobile/src/app/plus.tsx:34-57` and the `PriceRow` component at `:69-79`

**Interfaces:**
- Consumes: `PurchasesOffering`, `PurchasesPackage` from `react-native-purchases`; existing `GoldButton`, `Ritual`, `Mono`, `DecodeLine`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Lift the price rows above the creed**

In `apps/mobile/src/app/plus.tsx`, replace the contents of the main `<View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>` so the order becomes: eyebrow → price rows (or their loading/error line) → creed as supporting text → renewal terms. The creed drops from `size={12}` centred to `size={11}` left-aligned, because it now supports the offer rather than being the page:

```tsx
        <Eyebrow>Oracle plus</Eyebrow>
        {plusActive ? (
          <Mono size={11} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>{PUSH_CAMPAIGN_LINES.plusWelcome}</Mono>
        ) : offering === "loading" ? (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>CONSULTING THE STORE…</Mono>
        ) : offering === null ? (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>THE STORE IS BEYOND THE VEIL. RETURN LATER.</Mono>
        ) : (
          <View style={{ gap: space(3) }}>
            {offering.annual && <PriceRow pkg={offering.annual} tag="TWELVE MOONS" onPress={buy} featured />}
            {offering.monthly && <PriceRow pkg={offering.monthly} tag="ONE MOON" onPress={buy} />}
          </View>
        )}
        {errorLine && <Mono size={10} color={colors.vermilion} letterSpacing={2} style={{ textAlign: "center" }}>{errorLine}</Mono>}
        {/* The creed supports the offer now instead of standing in front of
            it (spec §6). Left-aligned and a step down in size: this is the
            argument, the rows above are the decision. */}
        <View style={{ gap: space(2) }}>
          {CREED.map((l, i) => (
            <DecodeLine key={l.id} text={l.text} delayMs={i * 160} durationMs={450} size={11} color={colors.mutedInk} letterSpacing={2} style={{ lineHeight: 19 }} />
          ))}
        </View>
        <Mono size={10} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center", lineHeight: 16 }}>
          AUTO-RENEWS UNTIL CANCELLED IN APP STORE SETTINGS. THE FREE GAME IS NEVER GATED.
        </Mono>
```

- [ ] **Step 2: Make the featured row legible as the recommendation**

Replace `PriceRow` with:

```tsx
function PriceRow({ pkg, tag, onPress, featured }: { pkg: PurchasesPackage; tag: string; onPress: (p: PurchasesPackage) => void; featured?: boolean }) {
  return (
    <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: featured ? colors.agedGold : colors.line, padding: space(4), gap: space(3) }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Mono size={10} color={featured ? colors.goldText : colors.mutedInk} letterSpacing={2}>{tag}</Mono>
        <Ritual bold size={featured ? 24 : 18} color={colors.ink} letterSpacing={1}>{pkg.product.priceString}</Ritual>
      </View>
      <GoldButton title={PAYWALL_CTA_LINES.subscribe} onPress={() => onPress(pkg)} />
    </View>
  );
}
```

The unfeatured border moves from `colors.mutedInk` (a text token used as a rule, and far too heavy) to `colors.line`, and the featured row's price grows so the recommendation is legible without a badge.

- [ ] **Step 3: Verify**

Run from `apps/mobile`: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/plus.tsx
git commit -m "feat(mobile): the offer leads, the creed supports"
```

---

### Task 9: The Summons asks one question

**Files:**
- Modify: `apps/mobile/src/app/summons.tsx:36-65`

**Interfaces:**
- Consumes: `SUMMONS_LINES` from `@oracle/core`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Empty the screen**

In `apps/mobile/src/app/summons.tsx`, replace the main content `<View>` and the footer `<View>` with:

```tsx
      {/* One question, and almost nothing else (spec §6). This screen exists
          to be answered in two seconds; every line that is not the question
          is weight the answer has to carry. */}
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: space(2) }}>
        <View style={{ gap: space(3) }}>
          {SUMMONS_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} delayMs={i * 160} durationMs={450} size={13} color={colors.ink} letterSpacing={2} style={{ lineHeight: 22, textAlign: "center" }} />
          ))}
        </View>
      </View>
      <View style={{ gap: space(2), paddingBottom: space(2) }}>
        <GoldButton title="LET IT SPEAK" onPress={onSpeak} />
        <QuietLink title="Not now" onPress={leave} />
        {restoreState === "none" && (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>
            NO RECORD BEARS THIS NAME.
          </Mono>
        )}
        {/* The restore link is not part of the question — it is a door for
            someone who arrived here by accident. It sits apart. */}
        <View style={{ paddingTop: space(3) }}>
          <QuietLink title="Restore a claimed record" onPress={handleRestore} />
        </View>
      </View>
```

Extract the existing inline `onPress` handler on the `GoldButton` to a named `onSpeak` function in the component body, unchanged in behaviour:

```tsx
  const onSpeak = async () => {
    try {
      // OneSignal owns the ask when it's live; local reminders still need OS
      // permission in dark mode, so that path falls back to the plain
      // expo-notifications prompt.
      if (KEYS.oneSignalAppId) await requestPushPermission();
      else await Notifications.requestPermissionsAsync();
    } catch {}
    leave();
  };
```

The `<Eyebrow>The summons</Eyebrow>` is deleted — the screen has one question and does not need to be labelled.

- [ ] **Step 2: Verify**

Run from `apps/mobile`: `pnpm typecheck && pnpm lint`
Expected: no errors, and no unused-import warning for `Eyebrow` (remove it from the import if it is now unused).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/app/summons.tsx
git commit -m "feat(mobile): the summons asks once and gets out of the way"
```

---

### Task 10: Ship blockers — the privacy link and the silent share

**Files:**
- Modify: `apps/mobile/src/config/links.ts` (read first; the URL may belong here)
- Modify: `apps/mobile/src/app/plus.tsx:17` (`PRIVACY_URL`)
- Modify: `apps/mobile/src/app/reveal/[date].tsx:127-130` (`onShare`)
- Modify: `apps/mobile/src/app/ledger.tsx:159-165` (share handler)

**Interfaces:**
- Consumes: existing `Mono`, `colors`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Locate the real privacy URL**

Run from the repo root:
```bash
cat apps/mobile/src/config/links.ts
grep -rn "privacy\|PRIVACY" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" apps/ docs/ | grep -iv node_modules | head -20
```

If a real privacy URL exists anywhere in the repo, move `PRIVACY_URL` into `src/config/links.ts` alongside the other links and point `plus.tsx` at it. **If no real URL exists, do not invent one** — stop and report this to the reviewer as a blocking finding, leaving the constant untouched. A fabricated privacy URL in a shipped build is worse than a known-bad one.

- [ ] **Step 2: Give the share a voice when it fails**

In `apps/mobile/src/app/reveal/[date].tsx`, add to the component state:

```tsx
  const [shareError, setShareError] = useState<string | null>(null);
```

Replace `onShare` with:

```tsx
  async function onShare() {
    setSharing(true);
    setShareError(null);
    try {
      await shareCard(canvasRef, cardData);
    } catch {
      // Every other failure in this app has a written line; this one used to
      // be swallowed whole, so a failed share simply did nothing.
      setShareError("THE PROPHECY WOULD NOT LEAVE. TRY AGAIN.");
    } finally {
      setSharing(false);
    }
  }
```

Directly beneath the share `GoldButton`'s `Animated.View`, add:

```tsx
        {shareError && (
          <Mono size={10} color={colors.vermilion} letterSpacing={2} style={{ textAlign: "center" }}>{shareError}</Mono>
        )}
```

- [ ] **Step 3: The same for the ledger's plaque**

In `apps/mobile/src/app/ledger.tsx`, add `const [shareError, setShareError] = useState<string | null>(null);`, replace the `GoldButton`'s inline handler body's `catch {}` with `catch { setShareError("THE PLAQUE WOULD NOT LEAVE. TRY AGAIN."); }`, clear it with `setShareError(null)` at the start of the handler, and render the same vermilion line directly beneath that button.

- [ ] **Step 4: Verify**

Run from `apps/mobile`:
```bash
pnpm typecheck
grep -rn "catch {}" src/app/
```
Expected: no type errors; the grep returns no hits in `reveal/[date].tsx` or `ledger.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/plus.tsx apps/mobile/src/app/reveal/\[date\].tsx apps/mobile/src/app/ledger.tsx apps/mobile/src/config/links.ts
git commit -m "fix(mobile): a share that fails says so"
```

---

### Task 11: The ledger's stats gain a hierarchy and keep their frame while loading

**Files:**
- Modify: `apps/mobile/src/app/ledger.tsx` (the `Stat` component, the stat block, the loading branch)

**Interfaces:**
- Consumes: `scoreValue` from `src/game/scoreProgress.ts`; existing `Mono`, `Ritual`, `AsciiDust`, `DecodeLine`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Give `Stat` a lead variant**

In `apps/mobile/src/app/ledger.tsx`, replace `Stat` with:

```tsx
// Seven rows at one size read as seven equal facts. The Oracle Score is the
// headline — it is the number the epithet is derived from — so it takes the
// temple voice and its own rule, and the six supporting stats stay machine
// voice beneath it (refinement spec §7).
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Mono size={11} color={colors.mutedInk} letterSpacing={2}>{label}</Mono>
      <Mono size={11} color={colors.ink} letterSpacing={2}>{value}</Mono>
    </View>
  );
}

function LeadStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
      <Mono size={11} color={colors.goldText} letterSpacing={2}>{label}</Mono>
      <Ritual bold size={20} color={colors.ink} letterSpacing={1}>{value}</Ritual>
    </View>
  );
}
```

- [ ] **Step 2: Promote the score**

In the stat block, replace `<Stat label="ORACLE SCORE" value={scoreValue(d.oracle_score, d.calls_rated)} />` with:

```tsx
            <LeadStat label="ORACLE SCORE" value={scoreValue(d.oracle_score, d.calls_rated)} />
            <View style={{ height: 1, backgroundColor: colors.lineSoft, marginVertical: space(1) }} />
```

- [ ] **Step 3: Let the plaque fill rather than flash**

Replace the `if (!ledger.data) return (...)` early-return block with a version that keeps the plaque's frame standing and prints the wait inside it:

```tsx
  if (!ledger.data) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The forecaster&apos;s ledger</Eyebrow>
        {/* The frame holds while the record is fetched. It used to vanish and
            return, which read as a flash rather than a fill (spec §7). */}
        <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold, padding: space(5), gap: space(4), minHeight: 280, alignItems: "center", justifyContent: "center" }}>
          <AsciiDust />
          <DecodeLine text="THE LEDGER IS CONSULTED" cursor size={10} color={colors.goldText} letterSpacing={4} style={{ textAlign: "center" }} />
        </View>
      </View>
    </Screen>
  );
```

- [ ] **Step 4: Verify**

Run from `apps/mobile`: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/ledger.tsx
git commit -m "feat(mobile): the score leads the plaque, and the frame holds while it loads"
```

---

### Task 12: Pull to refresh, a scroll edge, and a button that presses like a consequence

**Files:**
- Modify: `apps/mobile/src/ui/Button.tsx` (add a `destructive` variant)
- Modify: `apps/mobile/src/ui/RiteConfirm.tsx` (pass `destructive` through)
- Modify: `apps/mobile/src/app/reveal/[date].tsx` (`RefreshControl`, scroll edge)
- Modify: `apps/mobile/src/app/index.tsx` (`RefreshControl`)

**Interfaces:**
- Consumes: `RefreshControl`, `ScrollView` from `react-native`; `useQueryClient` (already imported in both screens).
- Produces: `GoldButton` gains an optional `destructive?: boolean` prop.

- [ ] **Step 1: Consult the Expo 57 docs**

Read https://docs.expo.dev/versions/v57.0.0/ for the current `RefreshControl` guidance under React Native 0.86 before writing the scroll changes.

- [ ] **Step 2: Give the destructive action its own press**

In `apps/mobile/src/ui/Button.tsx`, extend `GoldButton`:

```tsx
export function GoldButton({ title, onPress, disabled, destructive = false }: { title: string; onPress: () => void; disabled?: boolean; destructive?: boolean }) {
  // A destructive rite must not press like an invitation: it wears the
  // vermilion sleeve, and its press is a warning weight rather than the
  // medium tap that confirms an ordinary action.
  const tone = destructive ? colors.vermilion : colors.agedGold;
  const textTone = destructive ? colors.vermilion : colors.goldText;
  const wash = destructive ? colors.vermilionWash : colors.goldWash;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        Haptics.impactAsync(destructive ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: disabled ? colors.line : tone,
        minHeight: 48, justifyContent: "center", alignItems: "center",
        paddingVertical: space(3), paddingHorizontal: space(4),
        opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
        backgroundColor: pressed ? wash : "transparent",
      })}
    >
      <Mono {...typeScale.action} color={disabled ? colors.mutedInk : textTone} style={{ textTransform: "uppercase", ...trackTail(typeScale.action.letterSpacing) }}>{title}</Mono>
    </Pressable>
  );
}
```

In `apps/mobile/src/ui/RiteConfirm.tsx`, change `<GoldButton title={confirmLabel} onPress={onConfirm} />` to `<GoldButton title={confirmLabel} onPress={onConfirm} destructive={destructive} />`.

- [ ] **Step 3: Pull to refresh on Home**

In `apps/mobile/src/app/index.tsx`, wrap the existing content. `Screen` renders a plain `View` with padding, so the `ScrollView` goes inside it. Add imports for `ScrollView` and `RefreshControl` from `react-native`, add:

```tsx
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // A daily-ritual app with a fixed drop time guarantees the pull instinct.
    await qc.invalidateQueries();
    setRefreshing(false);
  }, [qc]);
```

and wrap the whole `<Screen>` body in:

```tsx
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedInk} colors={[colors.agedGold]} />}
      >
        …existing children…
      </ScrollView>
```

The `contentContainerStyle={{ flexGrow: 1 }}` is load-bearing: Home's layout depends on `flex: 1` on the temple register, which a `ScrollView` otherwise collapses.

- [ ] **Step 4: Pull to refresh and a scroll edge on the reveal**

In `apps/mobile/src/app/reveal/[date].tsx`, add the same `refreshing`/`onRefresh` pair (invalidating only `["reveal", date]`) and pass a matching `refreshControl` to the existing `ScrollView`.

For the fold, add a hairline that reports there is more below — after the `ScrollView`, inside `Screen`:

```tsx
      {/* The Big One and the share button live below the fold on smaller
          devices, and nothing said so. */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, backgroundColor: colors.museumWhite, opacity: 0.9 }} />
```

Only render it while the content actually overflows: track `const [overflows, setOverflows] = useState(false);` and set it from the `ScrollView`'s `onContentSizeChange` / `onLayout` pair (`contentHeight > viewportHeight`). Gate the fade on `overflows`.

- [ ] **Step 5: Verify**

Run from `apps/mobile`: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/ui/Button.tsx apps/mobile/src/ui/RiteConfirm.tsx apps/mobile/src/app/index.tsx apps/mobile/src/app/reveal/\[date\].tsx
git commit -m "feat(mobile): the day can be pulled again, and a strike presses like one"
```

---

## Final verification

- [ ] Run the full suite from the repo root: `pnpm test && pnpm typecheck`
- [ ] Run `cd apps/mobile && pnpm lint`
- [ ] Launch on device/simulator and walk the whole flow: boot rite → Home → Rites → Round (pull a card, seal it, watch the status field tick) → CrowdReveal → Ledger (strike rite, withdraw) → Plus → Reveal → share.
- [ ] Repeat the walk with **Settings → Accessibility → Larger Text** at maximum, confirming no clipped chrome and no shifted temple register on Home.
- [ ] Repeat the walk with **Reduce Motion** on, confirming the RiteConfirm appears without animation and every decode resolves instantly.
