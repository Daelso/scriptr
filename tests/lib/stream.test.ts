import { describe, it, expect } from "vitest";
import { chunkBySectionBreak, StreamEvent } from "@/lib/stream";

async function collect(input: string[]): Promise<StreamEvent[]> {
  async function* gen() {
    for (const x of input) yield x;
  }
  const events: StreamEvent[] = [];
  for await (const e of chunkBySectionBreak(gen())) events.push(e);
  return events;
}

function textOf(events: StreamEvent[]): string {
  return events
    .filter((e): e is Extract<StreamEvent, { type: "token" }> => e.type === "token")
    .map((e) => e.text)
    .join("");
}

describe("chunkBySectionBreak", () => {
  it("empty input yields only done", async () => {
    const events = await collect([]);
    expect(events).toEqual([{ type: "done" }]);
  });

  it("single token with no newlines emits token then done", async () => {
    const events = await collect(["Hello"]);
    expect(events).toEqual([{ type: "token", text: "Hello" }, { type: "done" }]);
  });

  it("simple split tokens reconstruct correctly", async () => {
    const events = await collect(["He", "llo"]);
    const doneEvents = events.filter((e) => e.type === "done");
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(textOf(events)).toBe("Hello");
    expect(doneEvents).toHaveLength(1);
    expect(breakEvents).toHaveLength(0);
  });

  it("input with one break yields section-break and correct text", async () => {
    const events = await collect(["Scene one.\n", "---\n", "Scene two."]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);
    expect(textOf(events)).toBe("Scene one.\nScene two.");
  });

  it("spec test: section break in single token stream", async () => {
    const events = await collect(["Scene one.", "\n---\n", "Scene two."]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);

    // Verify ordering: token(s) for scene one, section-break, token(s) for scene two, done
    const breakIndex = events.findIndex((e) => e.type === "section-break");
    const doneIndex = events.findIndex((e) => e.type === "done");
    expect(breakIndex).toBeGreaterThan(0);
    expect(doneIndex).toBe(events.length - 1);

    // All token events before break should contain "Scene one" content
    const beforeBreak = events.slice(0, breakIndex);
    expect(beforeBreak.every((e) => e.type === "token")).toBe(true);

    // All token events after break (and before done) should contain "Scene two" content
    const afterBreak = events.slice(breakIndex + 1, doneIndex);
    expect(afterBreak.every((e) => e.type === "token")).toBe(true);
    expect(textOf(afterBreak)).toContain("Scene two.");
  });

  it("--- inside a longer line is NOT a break", async () => {
    const events = await collect(["This has --- inside\nmore\n"]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(0);
  });

  it("--- at end of longer line is NOT a break", async () => {
    const events = await collect(["Hello ---\n"]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(0);
  });

  it("--- with trailing text on same line is NOT a break", async () => {
    const events = await collect(["---abc\n"]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(0);
  });

  it("spec test: --- split across tokens yields exactly one section-break", async () => {
    const events = await collect(["Scene.\n--", "-\nScene two."]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);
    expect(textOf(events)).toContain("Scene.");
    expect(textOf(events)).toContain("Scene two.");
  });

  it("multiple breaks yield correct count of section-break events", async () => {
    const events = await collect(["A\n---\nB\n---\nC"]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(2);
  });

  it("break at very start emits section-break before any tokens", async () => {
    const events = await collect(["---\nContent"]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);
    // The section-break should be the first event
    expect(events[0]).toEqual({ type: "section-break" });
  });

  it("break at very end with no trailing newline uses final-buffer branch", async () => {
    const events = await collect(["Content\n---"]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);
    // Content token(s) come before section-break, done is last
    const breakIndex = events.findIndex((e) => e.type === "section-break");
    expect(breakIndex).toBeGreaterThan(0);
    expect(events[events.length - 1]).toEqual({ type: "done" });
    expect(textOf(events)).toContain("Content");
  });

  it("Windows line endings CRLF are handled correctly", async () => {
    const events = await collect(["A\r\n---\r\nB"]);
    const breakEvents = events.filter((e) => e.type === "section-break");
    expect(breakEvents).toHaveLength(1);
  });

  it("done event is always the last event", async () => {
    const simple = await collect(["He", "llo"]);
    expect(simple[simple.length - 1].type).toBe("done");

    const withBreak = await collect(["A\n---\nB"]);
    expect(withBreak[withBreak.length - 1].type).toBe("done");

    const splitBreak = await collect(["Scene.\n--", "-\nScene two."]);
    expect(splitBreak[splitBreak.length - 1].type).toBe("done");
  });
});
