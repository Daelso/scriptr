import { describe, it, expect } from "vitest";
import {
  buildChapterPrompt,
  buildSectionRegenPrompt,
  buildRecapPrompt,
  buildContinuePrompt,
} from "@/lib/prompts";
import { DEFAULT_STYLE, type StyleRules } from "@/lib/style";
import type { Bible, Story, Chapter } from "@/lib/types";

const baseBible: Bible = {
  characters: [{ name: "Alice", description: "curious cat" }],
  setting: "an attic",
  pov: "third-limited",
  tone: "whimsical",
  styleNotes: "short sentences",
  nsfwPreferences: "fade to black",
};

const baseStory: Story = {
  slug: "my-story",
  title: "My Story",
  authorPenName: "Jane Doe",
  description: "",
  copyrightYear: 2026,
  language: "en",
  bisacCategory: "FIC027000",
  keywords: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  chapterOrder: [],
};

const baseChapter: Chapter = {
  id: "ch1",
  title: "Chapter One",
  summary: "Alice finds a key.",
  beats: ["Alice wakes up", "She finds a key", "She unlocks a door"],
  prompt: "",
  recap: "",
  sections: [],
  wordCount: 0,
};

// ─── buildChapterPrompt ───────────────────────────────────────────────────────

describe("buildChapterPrompt", () => {
  it("1. returns { system, user } with non-empty strings", () => {
    const result = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    });
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("2. user contains all bible field values verbatim", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("Alice");
    expect(user).toContain("an attic");
    expect(user).toContain("whimsical");
    expect(user).toContain("short sentences");
    expect(user).toContain("fade to black");
    expect(user).toContain("third-limited");
  });

  it("3. user contains chapter beats as markdown list items", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("- Alice wakes up");
    expect(user).toContain("- She finds a key");
    expect(user).toContain("- She unlocks a door");
  });

  it("4. user contains prior recaps prefixed with Ch.N — format", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [
        { chapterIndex: 1, recap: "Met the cat" },
        { chapterIndex: 2, recap: "Found the door" },
      ],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("Ch.1 — Met the cat");
    expect(user).toContain("Ch.2 — Found the door");
  });

  it("5. user ends with the scene-break sentinel", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    });
    expect(user.endsWith("Separate scenes with a line containing exactly '---'.")).toBe(true);
  });

  it("6. includes last chapter full text when flag is true", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      includeLastChapterFullText: true,
      lastChapterFullText: "The cat yawned.",
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("The cat yawned.");
  });

  it("7. excludes last chapter full text when flag is false or not set", () => {
    const withFalse = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      includeLastChapterFullText: false,
      lastChapterFullText: "The cat yawned.",
      style: DEFAULT_STYLE,
    });
    expect(withFalse.user).not.toContain("The cat yawned.");

    const withoutFlag = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      lastChapterFullText: "The cat yawned.",
      style: DEFAULT_STYLE,
    });
    expect(withoutFlag.user).not.toContain("The cat yawned.");
  });

  it("8. empty beats renders gracefully without crashing", () => {
    const chapterNoBeats = { ...baseChapter, beats: [] };
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: chapterNoBeats,
      style: DEFAULT_STYLE,
    });
    expect(user).toBeTruthy();
    expect(user).toContain("(none)");
  });

  it("9. empty priorRecaps renders gracefully", () => {
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    });
    expect(user).toBeTruthy();
    expect(user).toContain("(no prior chapters)");
  });

  it("10. empty characters still renders bible block", () => {
    const bibleNoChars = { ...baseBible, characters: [] };
    const { user } = buildChapterPrompt({
      story: baseStory,
      bible: bibleNoChars,
      priorRecaps: [],
      chapter: baseChapter,
      style: DEFAULT_STYLE,
    });
    expect(user).toBeTruthy();
    // Characters block should still appear, just with placeholder
    expect(user).toContain("(none)");
  });
});

describe("buildChapterPrompt with style rules", () => {
  const noOpStyle: Required<StyleRules> = {
    useContractions: false,
    noEmDashes: false,
    noSemicolons: false,
    noNotXButY: false,
    noRhetoricalQuestions: false,
    sensoryGrounding: false,
    consentBeats: false,
    adultsOnly: false,
    bodiesDirectlyNamed: false,
    rampArousal: false,
    interiorPOVInSex: false,
    noSuddenly: false,
    dialogueDuringSex: false,
    kinksAsLived: false,
    mandatoryAftermath: false,
    noBeganTo: false,
    noWeatherMirror: false,
    onePOVPerScene: false,
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

// ─── buildSectionRegenPrompt ──────────────────────────────────────────────────

describe("buildSectionRegenPrompt", () => {
  const sections = [
    { id: "s1", content: "Section one content." },
    { id: "s2", content: "Section two content." },
    { id: "s3", content: "Section three content." },
  ];
  const chapterWithSections = { ...baseChapter, sections };

  it("1. returns { system, user }", () => {
    const result = buildSectionRegenPrompt({
      story: baseStory,
      bible: baseBible,
      chapter: chapterWithSections,
      targetSectionId: "s2",
      regenNote: "more sensory",
      style: DEFAULT_STYLE,
    });
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("2. sections are joined with \\n---\\n", () => {
    const { user } = buildSectionRegenPrompt({
      story: baseStory,
      bible: baseBible,
      chapter: chapterWithSections,
      targetSectionId: "s2",
      regenNote: "more sensory",
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("\n---\n");
  });

  it("3. target section wrapped with REWRITE markers; others appear as plain content", () => {
    const { user } = buildSectionRegenPrompt({
      story: baseStory,
      bible: baseBible,
      chapter: chapterWithSections,
      targetSectionId: "s2",
      regenNote: "more sensory",
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("⟪REWRITE:more sensory⟫");
    expect(user).toContain("Section two content.");
    expect(user).toContain("⟪/REWRITE⟫");
    // s1 and s3 appear as plain content (not wrapped)
    expect(user).toContain("Section one content.");
    expect(user).toContain("Section three content.");
    // Verify s1 is NOT wrapped
    expect(user).not.toContain("⟪REWRITE:more sensory⟫\nSection one content.");
    expect(user).not.toContain("⟪REWRITE:more sensory⟫\nSection three content.");
  });

  it("4. system mentions output should be the rewritten scene only", () => {
    const { system } = buildSectionRegenPrompt({
      story: baseStory,
      bible: baseBible,
      chapter: chapterWithSections,
      targetSectionId: "s2",
      regenNote: "more sensory",
      style: DEFAULT_STYLE,
    });
    // System should say output is only the rewritten scene
    expect(system.toLowerCase()).toMatch(/output only|rewritten scene|only the rewritten/);
  });
});

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

// ─── buildContinuePrompt ─────────────────────────────────────────────────────

describe("buildContinuePrompt", () => {
  const truncatedChapter: Chapter = {
    ...baseChapter,
    sections: [
      { id: "sec-a", content: "Scene A prose." },
      { id: "sec-b", content: "Scene B prose." },
    ],
  };

  it("1. returns { system, user } with non-empty strings", () => {
    const result = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: truncatedChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    });
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("2. user contains the joined truncated section contents", () => {
    const { user } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: truncatedChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("Scene A prose.");
    expect(user).toContain("Scene B prose.");
  });

  it("3. user contains regenNote when provided", () => {
    const { user } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: truncatedChapter,
      regenNote: "add more tension",
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("Regen note: add more tension");
  });

  it("4. user does NOT contain regen block when regenNote is empty", () => {
    const { user } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: truncatedChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    });
    expect(user).not.toContain("Regen note:");
  });

  it("5. system mentions 'Continue' and the --- separator", () => {
    const { system } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: truncatedChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    });
    expect(system).toContain("continuing");
    expect(system).toContain("---");
  });

  it("6. user ends with the scene-break sentinel", () => {
    const { user } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: truncatedChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    });
    expect(user.endsWith("Continue writing. Separate scenes with a line containing exactly '---'.")).toBe(true);
  });

  it("7. user shows (nothing yet) when chapter has no sections", () => {
    const emptyChapter = { ...baseChapter, sections: [] };
    const { user } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: emptyChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    });
    expect(user).toContain("(nothing yet)");
  });
});

describe("buildContinuePrompt with style rules", () => {
  const truncatedChapter: Chapter = {
    ...baseChapter,
    sections: [
      { id: "sec-a", content: "Scene A prose." },
      { id: "sec-b", content: "Scene B prose." },
    ],
  };

  it("injects # Style rules after the current-text block and before the final directive", () => {
    const { user } = buildContinuePrompt({
      story: baseStory,
      bible: baseBible,
      priorRecaps: [],
      chapter: truncatedChapter,
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
      chapter: truncatedChapter,
      regenNote: "",
      style: DEFAULT_STYLE,
    } as Parameters<typeof buildContinuePrompt>[0]);
    expect(system).not.toMatch(/# Style rules/);
  });
});

// ─── buildRecapPrompt ─────────────────────────────────────────────────────────

describe("buildRecapPrompt", () => {
  it("1. returns { system, user }", () => {
    const result = buildRecapPrompt({ story: baseStory, chapter: baseChapter });
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("2. system mentions 2-3 sentences and recap", () => {
    const { system } = buildRecapPrompt({ story: baseStory, chapter: baseChapter });
    expect(system).toMatch(/2.?3/);
    expect(system.toLowerCase()).toContain("recap");
  });

  it("3. user contains each section's content joined", () => {
    const chapterWithSections = {
      ...baseChapter,
      sections: [
        { id: "s1", content: "First section prose." },
        { id: "s2", content: "Second section prose." },
      ],
    };
    const { user } = buildRecapPrompt({ story: baseStory, chapter: chapterWithSections });
    expect(user).toContain("First section prose.");
    expect(user).toContain("Second section prose.");
  });

  it("4. both section contents appear in user when chapter has 2 sections", () => {
    const chapterWith2 = {
      ...baseChapter,
      sections: [
        { id: "a", content: "Alpha content." },
        { id: "b", content: "Beta content." },
      ],
    };
    const { user } = buildRecapPrompt({ story: baseStory, chapter: chapterWith2 });
    expect(user).toContain("Alpha content.");
    expect(user).toContain("Beta content.");
  });
});

describe("buildRecapPrompt never receives or emits style", () => {
  it("has a signature that does not include a style parameter", () => {
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
