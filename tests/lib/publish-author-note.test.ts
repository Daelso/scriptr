// @vitest-environment jsdom
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

import { buildAuthorNoteHtml, AUTHOR_NOTE_SANITIZE_OPTS } from "@/lib/publish/author-note";

describe("buildAuthorNoteHtml", () => {
  it("includes the heading and message wrapper", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>Thanks for reading!</p>",
    });
    expect(html).toContain('class="author-note"');
    expect(html).toContain("A note from the author");
    expect(html).toMatch(/<p>Thanks for reading!<\/p>/);
  });

  it("renders email as a mailto link when provided", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>x</p>",
      email: "jane@example.com",
    });
    expect(html).toContain('href="mailto:jane@example.com"');
    expect(html).toContain("jane@example.com</a>");
  });

  it("omits the email block when email is missing", async () => {
    const html = await buildAuthorNoteHtml({ messageHtml: "<p>x</p>" });
    expect(html).not.toContain("mailto:");
  });

  it("renders QR as <img src=data:image/png;base64,...> when mailingListUrl provided", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>x</p>",
      mailingListUrl: "https://list.example.com/jane",
    });
    expect(html).toMatch(/<img[^>]+src="data:image\/png;base64,[A-Za-z0-9+/=]+"[^>]*>/);
    expect(html).toContain('alt="QR code linking to the mailing list"');
    expect(html).toContain("https://list.example.com/jane</a>");
  });

  it("omits the QR + mailing-list block when mailingListUrl is missing", async () => {
    const html = await buildAuthorNoteHtml({ messageHtml: "<p>x</p>" });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Join the mailing list");
  });

  it("strips <script> injected via messageHtml", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<p>hi</p><script>alert(1)</script>',
    });
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toContain("alert(1)");
  });

  it("strips javascript: URLs even if the message tries to forge an <a>", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<a href="javascript:alert(1)">x</a>',
    });
    expect(html).not.toMatch(/javascript:/i);
  });

  it("strips data:text/html URLs", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<a href="data:text/html,<script>x</script>">bad</a>',
    });
    expect(html).not.toMatch(/data:text\/html/i);
  });

  it("preserves the legitimate data:image/png;base64 QR src", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: "<p>x</p>",
      mailingListUrl: "https://list.example.com/jane",
    });
    expect(html).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  });

  it("strips data:image/svg+xml (SVG bypass — SVGs can carry scripts)", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="x" />',
    });
    expect(html).not.toMatch(/data:image\/svg\+xml/i);
  });

  it("preserves bold/italic/links from a TipTap-style messageHtml", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<p>Thanks for <strong>reading</strong>! <a href="https://example.com">More</a></p>',
    });
    expect(html).toContain("<strong>reading</strong>");
    expect(html).toContain('href="https://example.com"');
  });

  it("AUTHOR_NOTE_SANITIZE_OPTS is exported and usable by SafeHtml", () => {
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_TAGS).toContain("a");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_TAGS).toContain("img");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_ATTR).toContain("href");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_ATTR).toContain("src");
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("mailto:x@y")).toBe(true);
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("javascript:alert(1)")).toBe(false);
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("data:image/png;base64,abc")).toBe(true);
    expect(AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP.test("data:image/svg+xml;base64,abc")).toBe(false);
  });

  it("strips data-* attributes injected via messageHtml", async () => {
    // DOMPurify defaults `ALLOW_DATA_ATTR` to true. The sanitize opts now
    // explicitly turn it off so the attribute surface area is exactly what
    // ALLOWED_ATTR lists. Use an attribute that survives DOMPurify's other
    // checks (anchor + http link) so we know the strip we observe is from
    // the data-* policy, not some other rule.
    const html = await buildAuthorNoteHtml({
      messageHtml: '<a href="https://example.com" data-evil="1">x</a>',
    });
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("data-evil");
  });

  it("strips aria-* attributes injected via messageHtml", async () => {
    const html = await buildAuthorNoteHtml({
      messageHtml: '<a href="https://example.com" aria-evil="1">x</a>',
    });
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("aria-evil");
  });
});
