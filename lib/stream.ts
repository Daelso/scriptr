export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "section-break" }
  | { type: "done" };

export async function* chunkBySectionBreak(
  tokens: AsyncIterable<string>
): AsyncIterable<StreamEvent> {
  let buffer = "";
  for await (const chunk of tokens) {
    buffer += chunk;
    const lines = buffer.split("\n");
    // Keep the last segment (potentially partial) in the buffer.
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.replace(/\r$/, "");
      if (line === "---") {
        yield { type: "section-break" };
      } else {
        yield { type: "token", text: raw + "\n" };
      }
    }
  }
  if (buffer.length > 0) {
    const line = buffer.replace(/\r$/, "");
    if (line === "---") {
      yield { type: "section-break" };
    } else {
      yield { type: "token", text: buffer };
    }
  }
  yield { type: "done" };
}
