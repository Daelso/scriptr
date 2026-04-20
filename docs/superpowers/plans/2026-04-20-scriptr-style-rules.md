# scriptr Style Rules Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-layer (built-ins → global config → per-story bible) style-rules system that injects a numbered `# Style rules` block into every Grok prompt used for prose generation (chapter, continue, section-regen). Surface global toggles on the Settings page and per-toggle tri-state overrides on the Bible editor.

**Architecture:** Pure-function core in a new `lib/style.ts` module (types, defaults, resolver, formatter). Optional fields added to `Config` and `Bible` types — additive, no migration. Three prompt builders in `lib/prompts.ts` gain a `style` parameter and append the formatted rules block after story context but before the write directive. `buildRecapPrompt` is deliberately untouched. The three generate-route handlers each call `resolveStyleRules(config, bible)` and pass the result into the appropriate builder. UI work extends [components/settings/SettingsForm.tsx](../../../components/settings/SettingsForm.tsx) and [components/editor/BibleSection.tsx](../../../components/editor/BibleSection.tsx).

**Tech Stack:** Next.js 15 (App Router), TypeScript, React 19, vitest, Playwright, shadcn/ui, Zustand (not touched here), SWR, Tailwind.

**Reference spec:** [docs/superpowers/specs/2026-04-20-style-rules-design.md](../specs/2026-04-20-style-rules-design.md).

**Quality gates (run after every task):**
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — all green.

At the end of every task: commit. Small commits, frequent commits.

---

## Chunk 1: Foundation — `lib/style.ts`

Pure functions only. No React, no I/O, no `Config`/`Bible` dependency yet. This chunk produces a fully testable core that later chunks wire up.

### Task 1.1: Define `StyleRules` type + `DEFAULT_STYLE`

**Files:**
- Create: `lib/style.ts`
- Test: `tests/lib/style.test.ts`

- [ ] **Step 1: Write the failing test for the type shape and defaults**

Create `tests/lib/style.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";

describe("DEFAULT_STYLE", () => {
  it("has every field populated (no undefined)", () => {
    const keys: (keyof Required<StyleRules>)[] = [
      "useContractions",
      "noEmDashes",
      "noSemicolons",
      "noNotXButY",
      "noRhetoricalQuestions",
      "sensoryGrounding",
      "tense",
      "explicitness",
      "dialogueTags",
      "customRules",
    ];
    for (const k of keys) {
      expect(DEFAULT_STYLE[k]).not.toBeUndefined();
    }
  });

  it("matches the spec's built-in values", () => {
    expect(DEFAULT_STYLE).toEqual({
      useContractions: true,
      noEmDashes: true,
      noSemicolons: false,
      noNotXButY: true,
      noRhetoricalQuestions: true,
      sensoryGrounding: true,
      tense: "past",
      explicitness: "explicit",
      dialogueTags: "prefer-said",
      customRules: "",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/lib/style.test.ts`
Expected: FAIL with "Cannot find module '@/lib/style'".

- [ ] **Step 3: Create `lib/style.ts` with the type and constant**

```ts
// lib/style.ts

export type StyleRules = {
  useContractions?: boolean;
  noEmDashes?: boolean;
  noSemicolons?: boolean;
  noNotXButY?: boolean;
  noRhetoricalQuestions?: boolean;
  sensoryGrounding?: boolean;
  tense?: "past" | "present";
  explicitness?: "fade" | "suggestive" | "explicit" | "graphic";
  dialogueTags?: "prefer-said" | "vary";
  customRules?: string;
};

export const DEFAULT_STYLE: Required<StyleRules> = {
  useContractions: true,
  noEmDashes: true,
  noSemicolons: false,
  noNotXButY: true,
  noRhetoricalQuestions: true,
  sensoryGrounding: true,
  tense: "past",
  explicitness: "explicit",
  dialogueTags: "prefer-said",
  customRules: "",
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/lib/style.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors each.

- [ ] **Step 6: Commit**

```bash
git add lib/style.ts tests/lib/style.test.ts
git commit -m "feat(style): StyleRules type and DEFAULT_STYLE constant"
```

---

### Task 1.2: Implement `resolveStyleRules`

**Files:**
- Modify: `lib/style.ts`
- Test: `tests/lib/style.test.ts`

Note the spec's "custom-rules concatenation" invariant and the `stripUndefined` invariant — both are tested here.

- [ ] **Step 1: Add failing tests for the resolver**

Append to `tests/lib/style.test.ts`:

```ts
import { resolveStyleRules } from "@/lib/style";
import type { Config } from "@/lib/config";
import type { Bible } from "@/lib/types";

function cfg(styleDefaults?: StyleRules): Config {
  return {
    defaultModel: "grok-4-latest",
    bindHost: "127.0.0.1",
    bindPort: 3000,
    theme: "system",
    autoRecap: true,
    includeLastChapterFullText: false,
    styleDefaults,
  };
}

function bib(styleOverrides?: StyleRules): Bible {
  return {
    characters: [],
    setting: "",
    pov: "third-limited",
    tone: "",
    styleNotes: "",
    nsfwPreferences: "",
    styleOverrides,
  };
}

describe("resolveStyleRules", () => {
  it("returns built-ins when neither layer sets anything", () => {
    expect(resolveStyleRules(cfg(), bib())).toEqual(DEFAULT_STYLE);
  });

  it("applies globals over built-ins", () => {
    const r = resolveStyleRules(cfg({ tense: "present" }), bib());
    expect(r.tense).toBe("present");
    expect(r.useContractions).toBe(true); // unchanged
  });

  it("applies bible over globals", () => {
    const r = resolveStyleRules(
      cfg({ tense: "present" }),
      bib({ tense: "past" }),
    );
    expect(r.tense).toBe("past");
  });

  it("explicit-undefined in bible does NOT clobber global", () => {
    const r = resolveStyleRules(
      cfg({ tense: "present" }),
      bib({ tense: undefined }),
    );
    expect(r.tense).toBe("present");
  });

  it("concatenates customRules across layers with a newline", () => {
    const r = resolveStyleRules(
      cfg({ customRules: "global rule" }),
      bib({ customRules: "story rule" }),
    );
    expect(r.customRules).toBe("global rule\nstory rule");
  });

  it("customRules: empty bible leaves globals unchanged", () => {
    const r = resolveStyleRules(cfg({ customRules: "global rule" }), bib());
    expect(r.customRules).toBe("global rule");
  });

  it("customRules: empty globals leaves bible unchanged", () => {
    const r = resolveStyleRules(cfg(), bib({ customRules: "story rule" }));
    expect(r.customRules).toBe("story rule");
  });

  it("returns a Required<StyleRules> — no undefined fields", () => {
    const r = resolveStyleRules(cfg(), bib());
    for (const v of Object.values(r)) {
      expect(v).not.toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- tests/lib/style.test.ts`
Expected: FAIL — `resolveStyleRules` is not exported.

- [ ] **Step 3: Implement `resolveStyleRules`**

Append to `lib/style.ts`:

```ts
import type { Config } from "@/lib/config";
import type { Bible } from "@/lib/types";

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj) as [keyof T, T[keyof T]][]) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Resolve style rules across three layers (low → high precedence):
 *   built-ins → config.styleDefaults → bible.styleOverrides
 *
 * Invariants:
 *   - undefined on a higher layer does NOT clobber lower-layer values.
 *   - customRules concatenates rather than replaces — both layers' text
 *     contribute, joined with a single newline.
 */
export function resolveStyleRules(
  config: Config,
  bible: Bible,
): Required<StyleRules> {
  const globals = config.styleDefaults ?? {};
  const story = bible.styleOverrides ?? {};

  const merged: Required<StyleRules> = {
    ...DEFAULT_STYLE,
    ...stripUndefined(globals),
    ...stripUndefined(story),
  };

  // customRules is the one field that concatenates rather than replaces.
  const parts = [globals.customRules, story.customRules]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  merged.customRules = parts.join("\n");

  return merged;
}
```

> **Note on the type import:** `Config` comes from `lib/config.ts` which does not yet declare `styleDefaults?: StyleRules`. We'll add that field in Chunk 2. For now, add `styleDefaults?: StyleRules` to the `Config` type in-place — it's a purely additive change and lets us compile this module. Same for `Bible.styleOverrides?: StyleRules` on `lib/types.ts`. These type-only additions are committed as part of this task since `lib/style.ts` cannot typecheck without them.

- [ ] **Step 4: Add `styleDefaults?: StyleRules` to the Config type**

Edit `lib/config.ts`. In the `Config` type, add the field at the bottom:

```ts
import type { StyleRules } from "@/lib/style";

export type Config = {
  apiKey?: string;
  defaultModel: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  bindPort: number;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
};
```

Do **not** add it to `DEFAULT_CONFIG` — it stays undefined by default, and `resolveStyleRules` treats undefined as "use built-ins."

> **Circular-import warning:** `lib/style.ts` imports `Config` from `lib/config.ts`, and `lib/config.ts` imports `StyleRules` from `lib/style.ts`. Both are TYPE-only imports, so TypeScript resolves them statically and no runtime cycle exists. If the typecheck ever complains, confirm both are `import type` and `export type`.

- [ ] **Step 5: Add `styleOverrides?: StyleRules` to the Bible type**

Edit `lib/types.ts`. In the `Bible` type, add at the bottom:

```ts
import type { StyleRules } from "@/lib/style";

export type Bible = {
  characters: Character[];
  setting: string;
  pov: "first" | "second" | "third-limited" | "third-omniscient";
  tone: string;
  styleNotes: string;
  nsfwPreferences: string;
  styleOverrides?: StyleRules;
};
```

- [ ] **Step 6: Run tests to confirm they pass**

Run: `npm test -- tests/lib/style.test.ts`
Expected: all resolver tests PASS (8 tests including earlier 2).

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 TS errors, 0 lint errors, full suite green (was 297 passing + 1 todo; should now be 305 passing + 1 todo).

- [ ] **Step 8: Commit**

```bash
git add lib/style.ts lib/config.ts lib/types.ts tests/lib/style.test.ts
git commit -m "feat(style): resolveStyleRules three-layer merge"
```

---

### Task 1.3: Implement `formatStyleRules`

**Files:**
- Modify: `lib/style.ts`
- Test: `tests/lib/style.test.ts`

- [ ] **Step 1: Add failing tests for `formatStyleRules`**

Append to `tests/lib/style.test.ts`:

```ts
import { formatStyleRules } from "@/lib/style";

describe("formatStyleRules", () => {
  it("returns empty string only when no rule emits a line", () => {
    // In practice tense and explicitness are always known-valid and always emit,
    // so this is a synthetic edge case — we feed invalid enum literals to exercise
    // the "nothing to emit" code path. Real usage never hits this.
    const rules = {
      useContractions: false,
      noEmDashes: false,
      noSemicolons: false,
      noNotXButY: false,
      noRhetoricalQuestions: false,
      sensoryGrounding: false,
      tense: "unknown",
      explicitness: "unknown",
      dialogueTags: "vary",
      customRules: "",
    } as unknown as Required<StyleRules>;
    expect(formatStyleRules(rules)).toBe("");
  });

  it("with DEFAULT_STYLE the block is non-empty (baseline emits tense+explicitness+dialogueTags)", () => {
    // Real-world sanity check: the baseline built-in set always emits something.
    expect(formatStyleRules(DEFAULT_STYLE)).toMatch(/^# Style rules$/m);
  });

  it("emits each boolean toggle exactly when it is on", () => {
    const rules = {
      ...DEFAULT_STYLE,
      useContractions: true,
      noEmDashes: true,
      noSemicolons: true,
      noNotXButY: true,
      noRhetoricalQuestions: true,
      sensoryGrounding: true,
      tense: "past",
      explicitness: "explicit",
      dialogueTags: "prefer-said",
      customRules: "",
    } as const;
    const out = formatStyleRules(rules);
    expect(out).toMatch(/^# Style rules$/m);
    expect(out).toMatch(/Use contractions/);
    expect(out).toMatch(/Do not use em-dashes/);
    expect(out).toMatch(/Do not use semicolons/);
    expect(out).toMatch(/Avoid "it wasn't X, it was Y"/);
    expect(out).toMatch(/Avoid rhetorical questions/);
    expect(out).toMatch(/Favor concrete sensory detail/);
    expect(out).toMatch(/Write in past tense/);
    expect(out).toMatch(/Explicitness: explicit/);
    expect(out).toMatch(/Prefer "said" as the default dialogue tag/);
  });

  it("numbers rules contiguously with no gaps when toggles are off", () => {
    const rules: Required<StyleRules> = {
      ...DEFAULT_STYLE,
      useContractions: true,
      noEmDashes: false, // skipped
      noSemicolons: false,
      noNotXButY: true,
      noRhetoricalQuestions: false,
      sensoryGrounding: false,
      tense: "past",
      explicitness: "explicit",
      dialogueTags: "vary", // skipped
      customRules: "",
    };
    const out = formatStyleRules(rules);
    const numbered = out
      .split("\n")
      .filter((l) => /^\d+\./.test(l))
      .map((l) => parseInt(l.match(/^(\d+)/)![1], 10));
    // No gaps
    for (let i = 0; i < numbered.length; i++) {
      expect(numbered[i]).toBe(i + 1);
    }
  });

  it("renders every tense value distinctly", () => {
    expect(formatStyleRules({ ...DEFAULT_STYLE, tense: "past" })).toMatch(/past tense/);
    expect(formatStyleRules({ ...DEFAULT_STYLE, tense: "present" })).toMatch(/present tense/);
  });

  it("renders every explicitness tier distinctly", () => {
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "fade" })).toMatch(
      /fade-to-black/,
    );
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "suggestive" })).toMatch(
      /suggestive/,
    );
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "explicit" })).toMatch(
      /Explicitness: explicit/,
    );
    expect(formatStyleRules({ ...DEFAULT_STYLE, explicitness: "graphic" })).toMatch(
      /graphic/,
    );
  });

  it("dialogueTags: 'vary' produces NO dialogue-tag line", () => {
    const out = formatStyleRules({ ...DEFAULT_STYLE, dialogueTags: "vary" });
    expect(out).not.toMatch(/dialogue tag/i);
    expect(out).not.toMatch(/\"said\"/);
  });

  it("appends customRules verbatim under an 'Additional rules:' header", () => {
    const out = formatStyleRules({
      ...DEFAULT_STYLE,
      customRules: "never start a paragraph with 'Meanwhile'",
    });
    expect(out).toMatch(/Additional rules:\nnever start a paragraph with 'Meanwhile'/);
  });

  it("omits customRules when it is whitespace-only", () => {
    const out = formatStyleRules({ ...DEFAULT_STYLE, customRules: "   \n  " });
    expect(out).not.toMatch(/Additional rules/);
  });

  it("unknown tense value omits the tense line (graceful)", () => {
    // Simulates a hand-edited config.json with an invalid enum value
    const rules = { ...DEFAULT_STYLE, tense: "fugue" } as unknown as Required<StyleRules>;
    const out = formatStyleRules(rules);
    expect(out).not.toMatch(/tense/i);
  });

  it("unknown explicitness value omits the explicitness line (graceful)", () => {
    const rules = {
      ...DEFAULT_STYLE,
      explicitness: "cosmic",
    } as unknown as Required<StyleRules>;
    const out = formatStyleRules(rules);
    expect(out).not.toMatch(/Explicitness/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm test -- tests/lib/style.test.ts`
Expected: FAIL — `formatStyleRules` not exported.

- [ ] **Step 3: Implement `formatStyleRules`**

Append to `lib/style.ts`:

```ts
export function formatStyleRules(rules: Required<StyleRules>): string {
  const lines: string[] = [];

  if (rules.useContractions) {
    lines.push("Use contractions (I'm, don't, won't) in narration and dialogue.");
  }
  if (rules.noEmDashes) {
    lines.push("Do not use em-dashes. Use commas, periods, or parentheses instead.");
  }
  if (rules.noSemicolons) {
    lines.push("Do not use semicolons.");
  }
  if (rules.noNotXButY) {
    lines.push(`Avoid "it wasn't X, it was Y" constructions.`);
  }
  if (rules.noRhetoricalQuestions) {
    lines.push("Avoid rhetorical questions in narration.");
  }
  if (rules.sensoryGrounding) {
    lines.push("Favor concrete sensory detail over abstract emotion statements.");
  }

  switch (rules.tense) {
    case "past":
      lines.push("Write in past tense.");
      break;
    case "present":
      lines.push("Write in present tense.");
      break;
    // unknown values → omit
  }

  switch (rules.explicitness) {
    case "fade":
      lines.push(
        "Explicitness: fade-to-black — suggest intimacy, cut before physical detail.",
      );
      break;
    case "suggestive":
      lines.push(
        "Explicitness: suggestive — evocative but non-graphic; imply rather than describe.",
      );
      break;
    case "explicit":
      lines.push(
        "Explicitness: explicit — detailed physical and sensory description, no censorship or fade-outs.",
      );
      break;
    case "graphic":
      lines.push(
        "Explicitness: graphic — unflinching, anatomically specific, no euphemism.",
      );
      break;
    // unknown values → omit
  }

  if (rules.dialogueTags === "prefer-said") {
    lines.push(
      `Prefer "said" as the default dialogue tag. Vary only when the tag carries information.`,
    );
  }
  // "vary" is the no-op default — emit nothing.

  // Emit all zero-argument toggles first, then customRules addendum if present.
  const trimmedCustom = rules.customRules.trim();

  // Caller-friendly empty case: everything off AND no custom rules.
  if (lines.length === 0 && !trimmedCustom) return "";

  const numbered = lines.map((line, i) => `${i + 1}. ${line}`);

  if (trimmedCustom) {
    numbered.push(`${numbered.length + 1}. Additional rules:\n${trimmedCustom}`);
  }

  return `# Style rules\n${numbered.join("\n")}`;
}
```

- [ ] **Step 4: Run tests to verify**

Run: `npm test -- tests/lib/style.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors, full suite green.

> **Note on side effects to downstream work:** after this task `formatStyleRules(DEFAULT_STYLE)` always returns a non-empty block. That means any future code path that runs `resolveStyleRules → formatStyleRules` on a default config + empty bible will unconditionally include a `# Style rules` section in the prompt. Chunk 4 relies on this being intentional.

- [ ] **Step 6: Commit**

```bash
git add lib/style.ts tests/lib/style.test.ts
git commit -m "feat(style): formatStyleRules emits numbered instruction block"
```

---

## Chunk 2: Type & storage round-trip — `Config.styleDefaults` + `Bible.styleOverrides`

The types are already added in Chunk 1. This chunk validates that they persist, load, and round-trip correctly through the existing `loadConfig`/`saveConfig` and bible storage.

### Task 2.1: Config round-trip test for `styleDefaults`

**Files:**
- Modify: `tests/lib/config.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/lib/config.test.ts`:

```ts
  it("persists and reloads styleDefaults", async () => {
    await withTemp(async (dir) => {
      await saveConfig(dir, { styleDefaults: { tense: "present", noEmDashes: false } });
      delete process.env.XAI_API_KEY;
      const cfg = await loadConfig(dir);
      expect(cfg.styleDefaults).toEqual({ tense: "present", noEmDashes: false });
    });
  });

  it("leaves styleDefaults undefined when not saved", async () => {
    await withTemp(async (dir) => {
      delete process.env.XAI_API_KEY;
      const cfg = await loadConfig(dir);
      expect(cfg.styleDefaults).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run to confirm they pass immediately (no code change needed)**

Run: `npm test -- tests/lib/config.test.ts`
Expected: PASS. Config's `...partial` spread and `JSON.parse` already round-trip any field on the type.

> If they fail, your Chunk 1 Task 1.2 Step 4 edit didn't land. Go back and add `styleDefaults?: StyleRules` to the `Config` type.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/config.test.ts
git commit -m "test(style): config round-trips styleDefaults"
```

---

### Task 2.2: Bible round-trip test for `styleOverrides`

**Files:**
- Modify: `tests/lib/storage/bible.test.ts`
- Test: `tests/api/bible.test.ts` (optional smoke)

- [ ] **Step 1: Check the existing bible storage tests**

Run: `cat tests/lib/storage/bible.test.ts`

Look for how existing tests call `saveBible`/`getBible` and what shape they pass. Mirror that for the new test.

- [ ] **Step 2: Add failing test**

Append to `tests/lib/storage/bible.test.ts` (adjust imports / helper names to match the file's existing idioms — likely `mkdtemp` + the module's own storage helpers):

```ts
it("round-trips Bible.styleOverrides", async () => {
  await withTemp(async (dir) => {
    const slug = "test-story";
    // Use the file's existing test helpers to create a story, then:
    const bible: Bible = {
      characters: [],
      setting: "",
      pov: "third-limited",
      tone: "",
      styleNotes: "",
      nsfwPreferences: "",
      styleOverrides: { tense: "present", customRules: "no metaphors" },
    };
    await saveBible(dir, slug, bible);
    const loaded = await getBible(dir, slug);
    expect(loaded?.styleOverrides).toEqual({
      tense: "present",
      customRules: "no metaphors",
    });
  });
});
```

> Important: if the existing `saveBible` signature is shaped differently (e.g. no dataDir param, or named differently), **conform to what's there** rather than inventing. Read the top of the test file to find the exact symbol names and helpers.

- [ ] **Step 3: Run to confirm it passes**

Run: `npm test -- tests/lib/storage/bible.test.ts`
Expected: PASS — storage writes JSON verbatim, so additive optional fields just work.

- [ ] **Step 4: Commit**

```bash
git add tests/lib/storage/bible.test.ts
git commit -m "test(style): bible storage round-trips styleOverrides"
```

---

### Task 2.3: Settings route allowlist — accept `styleDefaults`

**Files:**
- Modify: `app/api/settings/route.ts`
- Modify: `tests/api/settings.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `tests/api/settings.test.ts` — mirror the existing `PUT` test patterns in that file:

```ts
it("PUT persists styleDefaults", async () => {
  // (shape the call like the existing PUT tests in this file)
  const res = await PUT(makeReq({ styleDefaults: { tense: "present", noEmDashes: false } }));
  const json = await res.json();
  expect(json.ok).toBe(true);

  const getRes = await GET();
  const getJson = await getRes.json();
  expect(getJson.data.styleDefaults).toEqual({
    tense: "present",
    noEmDashes: false,
  });
});

it("PUT ignores unknown top-level fields (existing allowlist behavior)", async () => {
  const res = await PUT(makeReq({ unknownField: "xxx" }));
  const json = await res.json();
  expect(json.ok).toBe(true);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm test -- tests/api/settings.test.ts`
Expected: the first new test FAILS because `styleDefaults` isn't on the `allowed` list — the PUT silently drops it, so GET returns no `styleDefaults`.

- [ ] **Step 3: Update the route**

Edit `app/api/settings/route.ts`:

**Change 1 — GET response.** Add `styleDefaults` to the returned object:

```ts
  return ok({
    hasKey: Boolean(cfg.apiKey),
    keyPreview: mask(cfg.apiKey),
    defaultModel: cfg.defaultModel,
    bindHost: cfg.bindHost,
    theme: cfg.theme,
    autoRecap: cfg.autoRecap,
    includeLastChapterFullText: cfg.includeLastChapterFullText,
    styleDefaults: cfg.styleDefaults,
  });
```

**Change 2 — PUT allowlist.** Add `"styleDefaults"` to the `allowed` array:

```ts
  const allowed: (keyof Config)[] = [
    "apiKey", "defaultModel", "theme", "autoRecap", "includeLastChapterFullText",
    "styleDefaults",
  ];
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npm test -- tests/api/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors, full suite green.

- [ ] **Step 6: Commit**

```bash
git add app/api/settings/route.ts tests/api/settings.test.ts
git commit -m "feat(style): settings route accepts styleDefaults"
```

---

## Chunk 3: Prompt integration

Extend three prompt builders to accept `style: Required<StyleRules>` and append `formatStyleRules(style)` at the specified injection point. Recap is deliberately not touched.

### Task 3.1: Extend `buildChapterPrompt`

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `tests/lib/prompts.test.ts`

- [ ] **Step 1: Add failing tests for the chapter prompt style injection**

Append to `tests/lib/prompts.test.ts`:

```ts
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";

describe("buildChapterPrompt with style rules", () => {
  const noOpStyle: Required<StyleRules> = {
    useContractions: false,
    noEmDashes: false,
    noSemicolons: false,
    noNotXButY: false,
    noRhetoricalQuestions: false,
    sensoryGrounding: false,
    tense: "unknown" as "past",
    explicitness: "unknown" as "explicit",
    dialogueTags: "vary",
    customRules: "",
  };

  it("injects # Style rules after beats and before the final write directive", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    } as Parameters<typeof buildChapterPrompt>[0]);

    const beatsIdx = user.indexOf("Beats:");
    const rulesIdx = user.indexOf("# Style rules");
    const writeIdx = user.indexOf("Write this chapter now");

    expect(beatsIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(beatsIdx);
    expect(writeIdx).toBeGreaterThan(rulesIdx);
  });

  it("omits the style block when formatStyleRules returns empty", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: noOpStyle,
    } as Parameters<typeof buildChapterPrompt>[0]);
    expect(user).not.toMatch(/# Style rules/);
    // write directive still present
    expect(user).toMatch(/Write this chapter now/);
  });

  it("leaves the system prompt unchanged (no style leakage into system)", () => {
    const { system } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    } as Parameters<typeof buildChapterPrompt>[0]);
    expect(system).not.toMatch(/# Style rules/);
    expect(system).not.toMatch(/Use contractions/);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npm test -- tests/lib/prompts.test.ts`
Expected: FAIL — `ChapterPromptInput` lacks `style`.

- [ ] **Step 3: Extend `buildChapterPrompt` and its input type**

Edit `lib/prompts.ts`:

1. Add import at the top:
   ```ts
   import { formatStyleRules, type StyleRules } from "@/lib/style";
   ```
2. Extend `ChapterPromptInput`:
   ```ts
   export type ChapterPromptInput = {
     story: Story;
     bible: Bible;
     priorRecaps: { chapterIndex: number; recap: string }[];
     chapter: Chapter;
     includeLastChapterFullText?: boolean;
     lastChapterFullText?: string;
     style: Required<StyleRules>;
   };
   ```
3. In the function body, compute the rules block and insert it between `Beats:\n${beatsBlock}${lastChapterSection}` and the final write directive:

   ```ts
   const rulesBlock = formatStyleRules(input.style);
   const rulesSection = rulesBlock ? `\n\n${rulesBlock}` : "";

   const user =
     `# Story bible\n${bibleBlock}\n\n` +
     `# Prior chapter recaps\n${priorRecapsBlock}\n\n` +
     `# Current chapter: ${input.chapter.title}\n${summaryBlock}${userPromptBlock}${targetBlock}` +
     `Beats:\n${beatsBlock}${lastChapterSection}${rulesSection}\n\n` +
     `Write this chapter now. Separate scenes with a line containing exactly '---'.`;
   ```

- [ ] **Step 4: Fix existing call sites that construct `ChapterPromptInput`**

Run: `npm run typecheck`
Expected: errors on `app/api/generate/route.ts` (and any tests that construct the input without `style`).

For the route, add `style: DEFAULT_STYLE` temporarily — Chunk 4 replaces this with `resolveStyleRules(config, bible)`:

```ts
import { DEFAULT_STYLE } from "@/lib/style";
// ...
  const prompt = buildChapterPrompt({
    story,
    bible,
    priorRecaps,
    chapter,
    includeLastChapterFullText: config.includeLastChapterFullText,
    lastChapterFullText,
    style: DEFAULT_STYLE, // TODO(chunk-4): resolve from config + bible
  });
```

For existing prompt tests in `tests/lib/prompts.test.ts` that call `buildChapterPrompt` without `style`, add `style: DEFAULT_STYLE` to each call. Find every call site first:

```bash
grep -n "buildChapterPrompt(" tests/lib/prompts.test.ts
```

Thread `style: DEFAULT_STYLE` through each one (typically 3–4 call sites). The TypeScript error messages from `npm run typecheck` will also enumerate the unfixed call sites.

- [ ] **Step 5: Run tests to confirm everything passes**

Run: `npm test -- tests/lib/prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors, full suite green.

- [ ] **Step 7: Commit**

```bash
git add lib/prompts.ts app/api/generate/route.ts tests/lib/prompts.test.ts
git commit -m "feat(style): buildChapterPrompt injects style rules"
```

---

### Task 3.2: Extend `buildContinuePrompt`

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `tests/lib/prompts.test.ts`

- [ ] **Step 1: Add failing tests mirroring Task 3.1 for continue mode**

Append to `tests/lib/prompts.test.ts`:

```ts
describe("buildContinuePrompt with style rules", () => {
  it("injects # Style rules after the current-text block and before the final directive", () => {
    const { user } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    } as Parameters<typeof buildContinuePrompt>[0]);

    const currentIdx = user.indexOf("Current text so far");
    const rulesIdx = user.indexOf("# Style rules");
    const continueIdx = user.indexOf("Continue writing");

    expect(currentIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(currentIdx);
    expect(continueIdx).toBeGreaterThan(rulesIdx);
  });

  it("leaves system prompt free of style content", () => {
    const { system } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    } as Parameters<typeof buildContinuePrompt>[0]);
    expect(system).not.toMatch(/# Style rules/);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- tests/lib/prompts.test.ts`
Expected: FAIL — `ContinuePromptInput` lacks `style`.

- [ ] **Step 3: Extend the type and function**

Edit `lib/prompts.ts`:

```ts
export type ContinuePromptInput = {
  story: Story;
  bible: Bible;
  priorRecaps: { chapterIndex: number; recap: string }[];
  chapter: Chapter;
  regenNote: string;
  style: Required<StyleRules>;
};
```

In `buildContinuePrompt`'s user-prompt construction, append the rules block after the current-text block and before the "Continue writing" line:

```ts
  const rulesBlock = formatStyleRules(input.style);
  const rulesSection = rulesBlock ? `\n\n${rulesBlock}` : "";

  const user =
    `# Story bible\n${bibleBlock}\n\n` +
    `# Prior chapter recaps\n${priorRecapsBlock}\n\n` +
    `# Current chapter: ${input.chapter.title}\n` +
    (input.chapter.summary ? `Summary: ${input.chapter.summary}\n\n` : "") +
    `Beats:\n${beatsBlock}\n\n` +
    `${regenBlock}` +
    `Current text so far:\n${currentText || "(nothing yet)"}${rulesSection}\n\n` +
    `Continue writing. Separate scenes with a line containing exactly '---'.`;
```

- [ ] **Step 4: Fix call sites**

Run: `npm run typecheck`

In `app/api/generate/route.ts` (the `handleContinue` handler), add `style: DEFAULT_STYLE` to the `buildContinuePrompt` call (will be replaced in Chunk 4).

Fix any existing test that calls `buildContinuePrompt` without `style`.

- [ ] **Step 5: Run tests**

Run: `npm run typecheck && npm test -- tests/lib/prompts.test.ts`
Expected: 0 TS errors, tests PASS.

- [ ] **Step 6: Full suite**

Run: `npm run lint && npm test`
Expected: 0 errors, full suite green.

- [ ] **Step 7: Commit**

```bash
git add lib/prompts.ts app/api/generate/route.ts tests/lib/prompts.test.ts
git commit -m "feat(style): buildContinuePrompt injects style rules"
```

---

### Task 3.3: Extend `buildSectionRegenPrompt`

**Files:**
- Modify: `lib/prompts.ts`
- Modify: `tests/lib/prompts.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/lib/prompts.test.ts`:

```ts
describe("buildSectionRegenPrompt with style rules", () => {
  const chapterWithSection: Chapter = {
    ...baseChapter,
    sections: [{ id: "s1", content: "The rose bloomed." }],
  };

  it("injects # Style rules after the current-scenes block", () => {
    const { user } = buildSectionRegenPrompt({
      story: baseStory,
      bible: baseBible,
      chapter: chapterWithSection,
      targetSectionId: "s1",
      regenNote: "hotter",
      style: DEFAULT_STYLE,
    } as Parameters<typeof buildSectionRegenPrompt>[0]);

    const scenesIdx = user.indexOf("# Current scenes");
    const rulesIdx = user.indexOf("# Style rules");

    expect(scenesIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeGreaterThan(scenesIdx);
  });

  it("leaves system prompt free of style content", () => {
    const { system } = buildSectionRegenPrompt({
      story: baseStory,
      bible: baseBible,
      chapter: chapterWithSection,
      targetSectionId: "s1",
      regenNote: "",
      style: DEFAULT_STYLE,
    } as Parameters<typeof buildSectionRegenPrompt>[0]);
    expect(system).not.toMatch(/# Style rules/);
  });
});
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- tests/lib/prompts.test.ts`
Expected: FAIL — `SectionRegenInput` lacks `style`.

- [ ] **Step 3: Extend the type and function**

Edit `lib/prompts.ts`:

```ts
export type SectionRegenInput = {
  story: Story;
  bible: Bible;
  chapter: Chapter;
  targetSectionId: string;
  regenNote: string;
  style: Required<StyleRules>;
};
```

Append the rules block to the user prompt after the joined scenes:

```ts
  const rulesBlock = formatStyleRules(input.style);
  const rulesSection = rulesBlock ? `\n\n${rulesBlock}` : "";

  const user =
    `# Story bible\n${bibleBlock}\n\n` +
    `# Chapter: ${chapter.title}\n\n` +
    `# Current scenes (rewrite only the marked one):\n${joined}${rulesSection}`;
```

- [ ] **Step 4: Fix call sites**

Run: `npm run typecheck`

In `app/api/generate/route.ts` (the `handleSection` handler), add `style: DEFAULT_STYLE` to the `buildSectionRegenPrompt` call.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/lib/prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors, full suite green.

- [ ] **Step 7: Commit**

```bash
git add lib/prompts.ts app/api/generate/route.ts tests/lib/prompts.test.ts
git commit -m "feat(style): buildSectionRegenPrompt injects style rules"
```

---

### Task 3.4: Confirm `buildRecapPrompt` is NOT given a `style` parameter

**Files:**
- Modify: `tests/lib/prompts.test.ts`

- [ ] **Step 1: Add a regression-lock test**

Append to `tests/lib/prompts.test.ts`:

```ts
describe("buildRecapPrompt never receives or emits style", () => {
  it("has a signature that does not include a style parameter", () => {
    // If this fails to typecheck after a future change, revisit the spec —
    // recap is plot summary and deliberately excluded from style rules.
    const _typeCheck: Parameters<typeof buildRecapPrompt>[0] = {
      story: baseStory,
      chapter: baseChapter,
      // @ts-expect-error style must NOT be on RecapPromptInput
      style: DEFAULT_STYLE,
    };
    expect(_typeCheck).toBeTruthy();
  });

  it("output contains no # Style rules block", () => {
    const { user, system } = buildRecapPrompt({
      story: baseStory,
      chapter: {
        ...baseChapter,
        sections: [{ id: "s1", content: "She opened the door." }],
      },
    });
    expect(user).not.toMatch(/# Style rules/);
    expect(system).not.toMatch(/# Style rules/);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/lib/prompts.test.ts`
Expected: PASS (the `@ts-expect-error` confirms the field is rejected; the output test trivially passes).

- [ ] **Step 3: Commit**

```bash
git add tests/lib/prompts.test.ts
git commit -m "test(style): lock in that buildRecapPrompt never accepts style"
```

---

## Chunk 4: Generate route wiring

Replace the Chunk-3 `DEFAULT_STYLE` placeholders with real `resolveStyleRules(config, bible)` calls. Add tests asserting the `.last-payload.json` for each mode contains the expected style block.

### Task 4.1: Wire `resolveStyleRules` into all three handlers

**Files:**
- Modify: `app/api/generate/route.ts`

- [ ] **Step 1: Update the imports**

In `app/api/generate/route.ts`:

```ts
import { resolveStyleRules } from "@/lib/style";
// Remove: import { DEFAULT_STYLE } from "@/lib/style";  (no longer needed)
```

- [ ] **Step 2: Replace placeholders**

In each of the three handlers (`handleFull`, `handleContinue`, `handleSection`), replace `style: DEFAULT_STYLE` with:

```ts
style: resolveStyleRules(config, bible),
```

The `config` and `bible` variables already exist in each handler's scope — no additional loads needed.

- [ ] **Step 3: Typecheck + lint + full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors, all green. Existing generate route tests keep passing because they use empty/default bibles — the resolved style is the built-in default, and the user-prompt assertions in those tests don't care about style-block presence.

- [ ] **Step 4: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "feat(style): generate routes resolve styleRules from config+bible"
```

---

### Task 4.2: Route tests — style block in `.last-payload.json`

**Files:**
- Modify: `tests/api/generate.test.ts`

- [ ] **Step 1: Add a failing test for full mode**

Append to `tests/api/generate.test.ts`. The file already has `beforeEach` setting `SCRIPTR_DATA_DIR=tmpDir` and `XAI_API_KEY=xai-test1234567890`, a hoisted `fakeCreate` mock, a `seed()` helper, a `consumeSSE` helper, and a `lastPayloadFile` import. Use them — do NOT invent your own fixtures:

```ts
import { saveBible, getBible } from "@/lib/storage/bible";

describe("POST /api/generate — style rules in .last-payload.json", () => {
  it("full mode: writes # Style rules block with tense and customRules from config.styleDefaults", async () => {
    // 1. Seed config.json BEFORE the request so loadConfig reads it. The test's
    //    beforeEach already sets SCRIPTR_DATA_DIR=tmpDir; just write config.json there.
    await writeFile(
      join(tmpDir, "config.json"),
      JSON.stringify({
        apiKey: "xai-test1234567890",
        styleDefaults: { tense: "present", customRules: "no metaphors" },
      }),
    );

    // 2. Seed story + chapter. createStory() writes a default bible automatically.
    const { story, chapter } = await seed();

    // 3. Stub the Grok stream — a single chunk is enough; we only care about the prompt.
    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "done.\n" }, { finish_reason: "stop" }]),
    );

    // 4. Drive the request and drain the SSE. Drain matters: the route writes
    //    .last-payload.json BEFORE the stream starts, so reading it after the
    //    response returns is safe, but draining SSE also gives us a deterministic
    //    checkpoint that the stream closed cleanly.
    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    expect(res.status).toBe(200);
    await consumeSSE(res);

    // 5. Read the payload file and assert.
    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as { model: string; mode: string; system: string; user: string };
    expect(payload.mode).toBe("full");
    expect(payload.user).toMatch(/# Style rules/);
    expect(payload.user).toMatch(/Write in present tense\./);
    expect(payload.user).toMatch(/Additional rules:\nno metaphors/);
    // And negative: no "past tense" should leak in
    expect(payload.user).not.toMatch(/Write in past tense/);
  });

  it("full mode: bible.styleOverrides take precedence over config.styleDefaults", async () => {
    await writeFile(
      join(tmpDir, "config.json"),
      JSON.stringify({
        apiKey: "xai-test1234567890",
        styleDefaults: { tense: "present" },
      }),
    );

    const { story, chapter } = await seed();

    // Override the auto-generated bible with styleOverrides pinning tense=past
    const bible = await getBible(tmpDir, story.slug);
    await saveBible(tmpDir, story.slug, {
      ...bible!,
      styleOverrides: { tense: "past" },
    });

    fakeCreate.mockResolvedValue(
      fakeStream([{ content: "done.\n" }, { finish_reason: "stop" }]),
    );

    const res = await POST(makeReq({ storySlug: story.slug, chapterId: chapter.id, mode: "full" }));
    await consumeSSE(res);

    const raw = await readFile(lastPayloadFile(tmpDir, story.slug), "utf-8");
    const payload = JSON.parse(raw) as { user: string };
    expect(payload.user).toMatch(/Write in past tense\./);
    expect(payload.user).not.toMatch(/Write in present tense/);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they pass**

Run: `npm test -- tests/api/generate.test.ts`
Expected: both new tests PASS. If they fail, inspect `.last-payload.json` manually in a failing-case breakpoint to see what actually ended up in `user`.

- [ ] **Step 3: Add analogous tests for continue and section modes**

Append two more tests to the same describe block. Follow the patterns from existing continue-mode and section-mode tests elsewhere in the file (grep for `mode: "continue"` and `mode: "section"` in the same file to find the setup pattern — both require a chapter with at least one existing section, which means using `updateChapter` after `seed()` to add a `Section[]`). For each:

- Seed `config.json` with a distinctive marker like `styleDefaults: { noEmDashes: true, customRules: "mode-marker-continue" }` or `"mode-marker-section"`.
- Execute the respective generation path.
- Read the payload file and assert the style block is present and contains the marker.

Concrete test names:

```ts
it("continue mode: .last-payload.json contains # Style rules", async () => { /* ... */ });
it("section mode: .last-payload.json contains # Style rules", async () => { /* ... */ });
```

- [ ] **Step 4: Full quality gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors, all green.

- [ ] **Step 5: Commit**

```bash
git add tests/api/generate.test.ts
git commit -m "test(style): .last-payload.json contains style block across all modes"
```

---

## Chunk 5: Globals UI — Settings page

Add a new "Writing style defaults" section to the settings form with all ten controls.

### Task 5.1: Extend `SettingsData` and `FormState`

**Files:**
- Modify: `components/settings/SettingsForm.tsx`

- [ ] **Step 1: Extend the types**

Edit `components/settings/SettingsForm.tsx`. Add `StyleRules` import and extend `SettingsData` + `FormState`:

```ts
import type { StyleRules } from "@/lib/style";

interface SettingsData {
  hasKey: boolean;
  keyPreview?: string;
  defaultModel: string;
  bindHost: string;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapterFullText: boolean;
  styleDefaults?: StyleRules;
}

interface FormState {
  apiKey: string;
  modelSelect: string;
  customModel: string;
  theme: "light" | "dark" | "system";
  autoRecap: boolean;
  includeLastChapter: boolean;
  style: Required<StyleRules>;
}
```

- [ ] **Step 2: Update `DEFAULT_FORM` to include a full style object**

```ts
import { DEFAULT_STYLE } from "@/lib/style";

const DEFAULT_FORM: FormState = {
  apiKey: "",
  modelSelect: "grok-4-latest",
  customModel: "",
  theme: "system",
  autoRecap: true,
  includeLastChapter: false,
  style: { ...DEFAULT_STYLE },
};
```

- [ ] **Step 3: Update `formFromData`**

```ts
function formFromData(data: SettingsData): FormState {
  return {
    apiKey: "",
    modelSelect: isKnownModel(data.defaultModel) ? data.defaultModel : "custom",
    customModel: isKnownModel(data.defaultModel) ? "" : data.defaultModel,
    theme: data.theme,
    autoRecap: data.autoRecap,
    includeLastChapter: data.includeLastChapterFullText,
    style: { ...DEFAULT_STYLE, ...(data.styleDefaults ?? {}) },
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/settings/SettingsForm.tsx
git commit -m "feat(style): settings form carries styleDefaults state"
```

---

### Task 5.2: Add the "Writing style defaults" UI section

**Files:**
- Modify: `components/settings/SettingsForm.tsx`

- [ ] **Step 1: Add the section markup**

Insert a new `<section>` between the existing "Generation" and "Appearance" sections (so it goes after the `includeLastChapter` switch and before the `<Separator />` that precedes "Appearance"):

```tsx
      <Separator />

      {/* ── Writing style defaults ─────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Writing Style Defaults
          </h2>
          <p className="text-xs text-muted-foreground">
            Rules injected into every generation prompt. Individual stories can override these.
          </p>
        </div>

        <StyleToggle
          id="use-contractions"
          label="Use contractions"
          description="I'm, don't, won't — in narration and dialogue"
          checked={form.style.useContractions ?? DEFAULT_STYLE.useContractions}
          onChange={(v) => patch({ style: { ...form.style, useContractions: v } })}
        />
        <StyleToggle
          id="no-em-dashes"
          label="Avoid em-dashes"
          description="Use commas, periods, or parentheses instead"
          checked={form.style.noEmDashes ?? DEFAULT_STYLE.noEmDashes}
          onChange={(v) => patch({ style: { ...form.style, noEmDashes: v } })}
        />
        <StyleToggle
          id="no-semicolons"
          label="Avoid semicolons"
          checked={form.style.noSemicolons ?? DEFAULT_STYLE.noSemicolons}
          onChange={(v) => patch({ style: { ...form.style, noSemicolons: v } })}
        />
        <StyleToggle
          id="no-not-x-but-y"
          label={`Avoid "it wasn't X, it was Y"`}
          checked={form.style.noNotXButY ?? DEFAULT_STYLE.noNotXButY}
          onChange={(v) => patch({ style: { ...form.style, noNotXButY: v } })}
        />
        <StyleToggle
          id="no-rhetorical-questions"
          label="Avoid rhetorical questions in narration"
          checked={form.style.noRhetoricalQuestions ?? DEFAULT_STYLE.noRhetoricalQuestions}
          onChange={(v) => patch({ style: { ...form.style, noRhetoricalQuestions: v } })}
        />
        <StyleToggle
          id="sensory-grounding"
          label="Favor concrete sensory detail"
          checked={form.style.sensoryGrounding ?? DEFAULT_STYLE.sensoryGrounding}
          onChange={(v) => patch({ style: { ...form.style, sensoryGrounding: v } })}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tense">Tense</Label>
          <Select
            value={form.style.tense ?? DEFAULT_STYLE.tense}
            onValueChange={(v) => {
              if (v === "past" || v === "present") {
                patch({ style: { ...form.style, tense: v } });
              }
            }}
          >
            <SelectTrigger id="tense" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="past">Past</SelectItem>
              <SelectItem value="present">Present</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="explicitness">Explicitness</Label>
          <Select
            value={form.style.explicitness ?? DEFAULT_STYLE.explicitness}
            onValueChange={(v) => {
              if (v === "fade" || v === "suggestive" || v === "explicit" || v === "graphic") {
                patch({ style: { ...form.style, explicitness: v } });
              }
            }}
          >
            <SelectTrigger id="explicitness" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fade">Fade-to-black</SelectItem>
              <SelectItem value="suggestive">Suggestive</SelectItem>
              <SelectItem value="explicit">Explicit</SelectItem>
              <SelectItem value="graphic">Graphic</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dialogue-tags">Dialogue tags</Label>
          <Select
            value={form.style.dialogueTags ?? DEFAULT_STYLE.dialogueTags}
            onValueChange={(v) => {
              if (v === "prefer-said" || v === "vary") {
                patch({ style: { ...form.style, dialogueTags: v } });
              }
            }}
          >
            <SelectTrigger id="dialogue-tags" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefer-said">Prefer &quot;said&quot;</SelectItem>
              <SelectItem value="vary">Vary freely</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="custom-rules">Additional rules</Label>
          <textarea
            id="custom-rules"
            className="min-h-20 rounded-md border bg-transparent p-2 text-sm"
            placeholder={`e.g. "never start a paragraph with 'Meanwhile'"`}
            value={form.style.customRules ?? ""}
            onChange={(e) => patch({ style: { ...form.style, customRules: e.target.value } })}
          />
          <p className="text-xs text-muted-foreground">
            Free-text rules appended verbatim. Different from Bible → Style Notes, which describes the story&apos;s voice.
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => patch({ style: { ...DEFAULT_STYLE } })}
        >
          Reset to built-in defaults
        </Button>
      </section>
```

- [ ] **Step 2: Add the local `StyleToggle` helper at the bottom of the file**

```tsx
function StyleToggle(props: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={props.id}>{props.label}</Label>
        {props.description && (
          <p className="text-xs text-muted-foreground">{props.description}</p>
        )}
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
    </div>
  );
}
```

- [ ] **Step 3: Update `handleSave` to send a diff against `DEFAULT_STYLE`**

Add a helper above the component (or co-located at the top of the file):

```ts
function diffAgainstDefault(current: Required<StyleRules>): StyleRules {
  const out: StyleRules = {};
  for (const k of Object.keys(DEFAULT_STYLE) as (keyof StyleRules)[]) {
    if (current[k] !== DEFAULT_STYLE[k]) {
      (out as Record<string, unknown>)[k] = current[k];
    }
  }
  return out;
}
```

In `handleSave`, pass the diff into the body:

```ts
      const body: Record<string, unknown> = {
        defaultModel: effectiveModel,
        theme: form.theme,
        autoRecap: form.autoRecap,
        includeLastChapterFullText: form.includeLastChapter,
        styleDefaults: diffAgainstDefault(form.style),
      };
```

> **Why diff instead of full object:** the spec explicitly requires that "Reset to built-in defaults" results in `styleDefaults` being `{}` on disk, so future changes to `DEFAULT_STYLE` propagate to users who never explicitly pinned values. Sending `form.style` verbatim would freeze today's defaults forever for any user who had ever opened Settings. The diff approach: each saved key represents a deliberate override of the current built-in. If `DEFAULT_STYLE` later changes a key the user hasn't pinned, they inherit the new default automatically.
>
> **customRules edge case:** a non-empty customRules never matches the default empty string, so it always persists when the user typed anything. An empty textarea correctly diffs out. ✓
>
> **Note for reviewers:** this means the stored `config.json` will often show only a handful of keys in `styleDefaults` (or `{}` after a Reset), not the full ten-key object. This is intentional and expected.

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Manually verify in the browser**

Start the dev server:

```bash
npm run dev
```

Visit http://127.0.0.1:3000/settings. Verify:

- The new "Writing Style Defaults" section renders between Generation and Appearance.
- All six switches, three selects, textarea, and Reset button are visible and interactive.
- Toggling a switch and clicking Save, then reloading the page, shows the saved state.
- Clicking "Reset to built-in defaults" returns every control to its default.
- Inspect `data/config.json` — `styleDefaults` is persisted.

Stop the dev server (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add components/settings/SettingsForm.tsx
git commit -m "feat(style): settings form renders writing style defaults section"
```

---

## Chunk 6: Per-story overrides UI — Bible editor

Add tri-state override controls inside the Bible editor pane.

### Task 6.1: Create `BibleStyleOverrides` component

**Files:**
- Create: `components/editor/BibleStyleOverrides.tsx`

- [ ] **Step 1: Scaffold the component**

Create `components/editor/BibleStyleOverrides.tsx`:

> **Filename note:** the spec §Component breakdown names this file `components/bible/StyleOverridesSection.tsx`. The plan deliberately uses `components/editor/BibleStyleOverrides.tsx` instead because (a) there is no `components/bible/` directory — the existing `BibleSection.tsx` lives in `components/editor/`, so the sibling placement is correct; and (b) the `Bible` prefix keeps it in alphabetical proximity to its parent in file listings. This is the only deviation from the spec's naming.

```tsx
"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";

type Props = {
  /** The bible's styleOverrides (partial; undefined means "inherit all"). */
  overrides: StyleRules | undefined;
  /** The resolved effective style — used to show "Inherit (<value>)" labels. */
  resolved: Required<StyleRules>;
  /** Called with the new overrides partial. Pass `undefined` to clear. */
  onChange: (next: StyleRules | undefined) => void;
};

type BoolKey =
  | "useContractions"
  | "noEmDashes"
  | "noSemicolons"
  | "noNotXButY"
  | "noRhetoricalQuestions"
  | "sensoryGrounding";

const BOOL_ROWS: { key: BoolKey; label: string }[] = [
  { key: "useContractions", label: "Use contractions" },
  { key: "noEmDashes", label: "Avoid em-dashes" },
  { key: "noSemicolons", label: "Avoid semicolons" },
  { key: "noNotXButY", label: `Avoid "it wasn't X, it was Y"` },
  { key: "noRhetoricalQuestions", label: "Avoid rhetorical questions" },
  { key: "sensoryGrounding", label: "Favor sensory detail" },
];

/**
 * Small dot rendered next to any label whose value is explicitly pinned on the
 * bible (diverging from the resolved/inherited value). Uses a shadcn theme
 * token (foreground with low opacity) to stay on-palette — no hardcoded color.
 */
function OverrideIndicator() {
  return (
    <span
      aria-label="Overridden"
      title="Overridden for this story"
      className="inline-block size-1.5 rounded-full bg-foreground/40"
    />
  );
}

/**
 * Tri-state control for a single boolean override field. Defined at module
 * scope (not inside the component body) so it preserves identity across
 * renders — otherwise every keystroke in the customRules textarea would
 * remount all six rows.
 */
function TriState({
  bKey,
  label,
  current,
  inherited,
  onChange,
}: {
  bKey: BoolKey;
  label: string;
  current: boolean | undefined;
  inherited: boolean;
  onChange: (v: boolean | undefined) => void;
}) {
  const overridden = current !== undefined;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}</Label>
        {overridden && <OverrideIndicator />}
      </div>
      <div className="inline-flex rounded-md border text-xs">
        <button
          type="button"
          className={cn("px-2 py-1", current === undefined && "bg-muted font-medium")}
          onClick={() => onChange(undefined)}
        >
          Inherit ({inherited ? "on" : "off"})
        </button>
        <button
          type="button"
          className={cn("px-2 py-1 border-l", current === true && "bg-muted font-medium")}
          onClick={() => onChange(true)}
        >
          On
        </button>
        <button
          type="button"
          className={cn("px-2 py-1 border-l", current === false && "bg-muted font-medium")}
          onClick={() => onChange(false)}
        >
          Off
        </button>
      </div>
    </div>
  );
}

export function BibleStyleOverrides({ overrides, resolved, onChange }: Props) {
  const o = overrides ?? {};

  function set<K extends keyof StyleRules>(key: K, value: StyleRules[K] | undefined) {
    const next = { ...o };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    // If result is empty, collapse to undefined so the bible's JSON drops the
    // whole key instead of persisting {}. JSON.stringify omits undefined values,
    // so an empty override set leaves no trace on disk.
    if (Object.keys(next).length === 0) {
      onChange(undefined);
    } else {
      onChange(next);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Override the Settings defaults for this story only.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(undefined)}
          className="h-7 text-xs"
        >
          Inherit all
        </Button>
      </div>

      {BOOL_ROWS.map((r) => (
        <TriState
          key={r.key}
          bKey={r.key}
          label={r.label}
          current={o[r.key]}
          inherited={resolved[r.key]}
          onChange={(v) => set(r.key, v)}
        />
      ))}

      {/* Tense */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs" htmlFor="ov-tense">Tense</Label>
          {o.tense !== undefined && <OverrideIndicator />}
        </div>
        <Select
          value={o.tense ?? "__inherit"}
          onValueChange={(v) => {
            if (v === "__inherit") set("tense", undefined);
            else if (v === "past" || v === "present") set("tense", v);
          }}
        >
          <SelectTrigger id="ov-tense" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit">Inherit ({resolved.tense})</SelectItem>
            <SelectItem value="past">Past</SelectItem>
            <SelectItem value="present">Present</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Explicitness */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs" htmlFor="ov-explicitness">Explicitness</Label>
          {o.explicitness !== undefined && <OverrideIndicator />}
        </div>
        <Select
          value={o.explicitness ?? "__inherit"}
          onValueChange={(v) => {
            if (v === "__inherit") set("explicitness", undefined);
            else if (v === "fade" || v === "suggestive" || v === "explicit" || v === "graphic") {
              set("explicitness", v);
            }
          }}
        >
          <SelectTrigger id="ov-explicitness" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit">Inherit ({resolved.explicitness})</SelectItem>
            <SelectItem value="fade">Fade-to-black</SelectItem>
            <SelectItem value="suggestive">Suggestive</SelectItem>
            <SelectItem value="explicit">Explicit</SelectItem>
            <SelectItem value="graphic">Graphic</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Dialogue tags */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs" htmlFor="ov-tags">Dialogue tags</Label>
          {o.dialogueTags !== undefined && <OverrideIndicator />}
        </div>
        <Select
          value={o.dialogueTags ?? "__inherit"}
          onValueChange={(v) => {
            if (v === "__inherit") set("dialogueTags", undefined);
            else if (v === "prefer-said" || v === "vary") set("dialogueTags", v);
          }}
        >
          <SelectTrigger id="ov-tags" className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit">Inherit ({resolved.dialogueTags})</SelectItem>
            <SelectItem value="prefer-said">Prefer &quot;said&quot;</SelectItem>
            <SelectItem value="vary">Vary freely</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Custom rules (additive) */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs" htmlFor="ov-custom">Additional rules (appended to global)</Label>
        <textarea
          id="ov-custom"
          className="min-h-16 rounded-md border bg-transparent p-2 text-sm"
          placeholder="Story-specific rules (combined with Settings → Additional rules)"
          value={o.customRules ?? ""}
          onChange={(e) => {
            const trimmed = e.target.value;
            set("customRules", trimmed === "" ? undefined : trimmed);
          }}
        />
      </div>
    </div>
  );
}
```

> **Note on design choices:**
> - The segmented tri-state control uses three native buttons rather than a shadcn component — kept local to the file to avoid introducing a new primitive.
> - `TriState` and `OverrideIndicator` live at module scope (not inside `BibleStyleOverrides`) so their component identity is stable across renders. A version nested inside the parent would remount every row on each keystroke in the customRules textarea.
> - The "overridden" indicator uses `bg-foreground/40` — a shadcn theme token with opacity, consistent with the project's "theme tokens only, no hardcoded colors" convention.
> - `__inherit` is a sentinel Select value. Radix/base-ui Selects don't accept `undefined` as a value string, so we pick a sentinel and translate.
> - `onChange(undefined)` (no overrides at all) writes a bible whose `styleOverrides` key is `undefined`; `JSON.stringify` omits it, so the on-disk bible.json never has a `"styleOverrides": {}` line. The verification in Task 6.2 Step 4 asserts exactly that — the key should be absent, not `{}`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/editor/BibleStyleOverrides.tsx
git commit -m "feat(style): BibleStyleOverrides tri-state component"
```

---

### Task 6.2: Embed `BibleStyleOverrides` in `BibleSection`

**Files:**
- Modify: `components/editor/BibleSection.tsx`

- [ ] **Step 1: Extend `BibleSection` state**

In `components/editor/BibleSection.tsx`, add styleOverrides state and include it in the derived bible:

```tsx
import { BibleStyleOverrides } from "@/components/editor/BibleStyleOverrides";
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";
import useSWR from "swr";
```

Inside the component:

```tsx
  const [styleOverrides, setStyleOverrides] = useState<StyleRules | undefined>(
    bible.styleOverrides,
  );

  // Fetch global settings to compute the resolved (effective) style for "Inherit (<value>)" labels
  const { data: settings } = useSWR<{ styleDefaults?: StyleRules }>(
    "/api/settings",
    async (url: string) => {
      const r = await fetch(url);
      const j = await r.json();
      return j.data;
    },
    { revalidateOnFocus: false },
  );

  const resolvedForDisplay = useMemo(() => {
    const globals = settings?.styleDefaults ?? {};
    return { ...DEFAULT_STYLE, ...globals, ...(styleOverrides ?? {}) };
  }, [settings, styleOverrides]);
```

Then add `styleOverrides` to the `currentBible` memo:

```tsx
  const currentBible = useMemo<Bible>(
    () => ({
      characters: stripIds(characters),
      setting,
      pov,
      tone,
      styleNotes,
      nsfwPreferences,
      styleOverrides,
    }),
    [characters, setting, pov, tone, styleNotes, nsfwPreferences, styleOverrides],
  );
```

- [ ] **Step 2: Add a new collapsible below the NSFW section**

After the `<Collapsible label="NSFW">` block, append:

```tsx
      {/* ── Style overrides (advanced) ─────────────────────────────── */}
      <Collapsible label="Style Overrides" defaultOpen={false}>
        <BibleStyleOverrides
          overrides={styleOverrides}
          resolved={resolvedForDisplay}
          onChange={setStyleOverrides}
        />
      </Collapsible>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Manually verify in the browser**

```bash
npm run dev
```

- Open or create a story with a bible.
- Confirm the "Style Overrides" collapsible appears, default-collapsed.
- Expand it. Verify the six tri-state rows, three selects, and textarea all render.
- Pin a rule (e.g. click "Off" on "Avoid em-dashes"). Confirm the `bg-foreground/40` dot appears next to the label.
- Wait for autosave (500ms debounce). Check `data/stories/<slug>/bible.json` — confirm exactly `"styleOverrides": { "noEmDashes": false }` is persisted (no extra keys).
- Click "Inherit" on that rule. Confirm the dot disappears and — crucially — the `"styleOverrides"` key is **absent** from the on-disk bible.json (not present as `{}`). This is the contract: `onChange(undefined)` → React state `styleOverrides = undefined` → `JSON.stringify` drops the key entirely.
- Click "Inherit all". Confirm all rows revert to inherit state.
- Go to Settings and change a global (e.g. flip `noEmDashes` off). Reopen the bible — the "Inherit" label for that row should now say "Inherit (off)".

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add components/editor/BibleSection.tsx
git commit -m "feat(style): embed style overrides panel in Bible editor"
```

---

### Task 6.3: End-to-end verification — run all quality gates

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run typecheck && npm run lint && npm test && npm run e2e`
Expected: 0 errors, all unit and integration tests green, Playwright e2e smoke passes.

- [ ] **Step 2: Privacy verification**

Run: `npm test -- tests/privacy/no-external-egress.test.ts`
Expected: PASS. The new feature adds no new routes, so the no-external-egress assertion should be untouched.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

1. Settings → Writing Style Defaults: flip "Avoid em-dashes" to off, set tense to "present", save.
2. Create a new story with a simple bible and one chapter with beats.
3. Open the chapter and click Generate.
4. After generation (or immediately on 401/500 if no API key is configured), read `data/stories/<slug>/.last-payload.json` — the route writes this **before** the upstream call, so it exists even if generation fails.
5. Confirm the payload's `user` field contains `# Style rules` and `Write in present tense.` but NOT `Do not use em-dashes.`.
6. Return to the bible, expand Style Overrides, override `tense` to `past`.
7. Trigger another generation; re-read `.last-payload.json` and confirm it now shows `Write in past tense.`.

Do not skip these verification steps — they're the end-to-end proof that the three-layer resolution works in production. A missing API key is not a reason to skip, because `.last-payload.json` is written before any network call.

- [ ] **Step 4: Commit the plan completion marker**

No code change. Just note completion in the commit log:

```bash
git log --oneline | head -15
```

Record how many commits were created (roughly one per task, ~15 total).

---

## Completion checklist

- [ ] All tasks in Chunks 1-6 marked complete with green commits.
- [ ] `npm run typecheck` reports 0 errors.
- [ ] `npm run lint` reports 0 errors.
- [ ] `npm test` reports full suite green (305+ tests).
- [ ] `npm run e2e` reports Playwright smoke passing.
- [ ] `tests/privacy/no-external-egress.test.ts` still green.
- [ ] Settings page shows Writing Style Defaults section.
- [ ] Bible editor shows Style Overrides collapsible.
- [ ] `.last-payload.json` contains `# Style rules` block for chapter/continue/section modes.
- [ ] Recap payloads contain NO style rules block.

When everything is checked: the feature is shippable. No follow-up plan is required unless the optional Playwright style-round-trip spec from the design document's §Testing is later added as polish.
