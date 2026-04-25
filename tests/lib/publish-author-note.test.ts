import { describe, it, expect } from "vitest";
import { resolveAuthorNote } from "@/lib/publish/author-note";
import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

const baseStory = (over: Partial<Story> = {}): Story => ({
  slug: "s", title: "T", authorPenName: "Jane",
  description: "", copyrightYear: 2026, language: "en",
  bisacCategory: "FIC027000", keywords: [],
  createdAt: "", updatedAt: "", chapterOrder: [],
  ...over,
});

describe("resolveAuthorNote", () => {
  it("returns null when no profile", () => {
    expect(resolveAuthorNote(baseStory(), undefined)).toBeNull();
  });

  it("returns null when authorNote.enabled === false", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>hi</p>" };
    const story = baseStory({ authorNote: { enabled: false, messageHtml: "<p>x</p>" } });
    expect(resolveAuthorNote(story, profile)).toBeNull();
  });

  it("returns story override when messageHtml is non-empty", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>default</p>" };
    const story = baseStory({ authorNote: { enabled: true, messageHtml: "<p>override</p>" } });
    expect(resolveAuthorNote(story, profile)?.messageHtml).toBe("<p>override</p>");
  });

  it("falls back to profile default when story override is empty/missing", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>default</p>" };
    expect(resolveAuthorNote(baseStory(), profile)?.messageHtml).toBe("<p>default</p>");
    const storyEmpty = baseStory({ authorNote: { enabled: true, messageHtml: "   " } });
    expect(resolveAuthorNote(storyEmpty, profile)?.messageHtml).toBe("<p>default</p>");
  });

  it("returns null when message AND email AND mailingListUrl are all empty", () => {
    expect(resolveAuthorNote(baseStory(), {})).toBeNull();
  });

  it("includes email and mailingListUrl when present", () => {
    const profile: PenNameProfile = {
      email: "j@example.com",
      mailingListUrl: "https://list.example.com",
      defaultMessageHtml: "<p>hi</p>",
    };
    const r = resolveAuthorNote(baseStory(), profile);
    expect(r).toEqual({
      messageHtml: "<p>hi</p>",
      email: "j@example.com",
      mailingListUrl: "https://list.example.com",
    });
  });

  it("treats undefined authorNote as enabled (default-on)", () => {
    const profile: PenNameProfile = { defaultMessageHtml: "<p>hi</p>" };
    expect(resolveAuthorNote(baseStory(), profile)).not.toBeNull();
  });
});
