import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "@/lib/publish/html-to-markdown";

describe("htmlToMarkdown", () => {
  it("returns plain text untouched when there are no tags", () => {
    expect(htmlToMarkdown("hello world")).toBe("hello world");
  });

  it("converts <strong> to **", () => {
    expect(htmlToMarkdown("He was <strong>angry</strong>.")).toBe(
      "He was **angry**."
    );
  });

  it("converts <b> the same as <strong>", () => {
    expect(htmlToMarkdown("<b>bold</b>")).toBe("**bold**");
  });

  it("converts <em> to *", () => {
    expect(htmlToMarkdown("She was <em>tired</em>.")).toBe("She was *tired*.");
  });

  it("converts <i> the same as <em>", () => {
    expect(htmlToMarkdown("<i>italic</i>")).toBe("*italic*");
  });

  it("handles nested strong inside em", () => {
    expect(htmlToMarkdown("<em>a <strong>b</strong> c</em>")).toBe("*a **b** c*");
  });

  it("handles nested em inside strong", () => {
    expect(htmlToMarkdown("<strong>a <em>b</em> c</strong>")).toBe("**a *b* c**");
  });

  it("converts <p> to double newline", () => {
    expect(htmlToMarkdown("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });

  it("converts <br> to single newline", () => {
    expect(htmlToMarkdown("line one<br>line two")).toBe("line one\nline two");
  });

  it("strips unknown tags, keeping inner text", () => {
    expect(htmlToMarkdown("<span>hello</span> <div>world</div>")).toBe(
      "hello world"
    );
  });

  it("decodes HTML entities", () => {
    expect(htmlToMarkdown("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;")).toBe(
      'a & b <c> "d" \'e\''
    );
  });

  it("decodes numeric entities", () => {
    expect(htmlToMarkdown("smart &#8212; dash")).toBe("smart \u2014 dash");
  });

  it("collapses excessive whitespace from source HTML", () => {
    expect(htmlToMarkdown("<p>  hello   world  </p>")).toBe("hello world");
  });

  it("handles a realistic Grok-style paragraph paste", () => {
    const html = '<p>She walked in and said <em>"hi."</em> He was <strong>angry</strong>.</p>';
    expect(htmlToMarkdown(html)).toBe(
      'She walked in and said *"hi."* He was **angry**.'
    );
  });

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});
