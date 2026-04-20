import { describe, it, expect } from "vitest";
import { registerJob, abortJob, clearJob } from "@/lib/generation-job";

describe("generation-job registry", () => {
  it("registerJob returns a UUID-shaped string and job can be aborted", () => {
    const abort = new AbortController();
    const id = registerJob({ abort, storySlug: "my-story", chapterId: "ch-1" });
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    const result = abortJob(id);
    expect(result).toBe(true);
    expect(abort.signal.aborted).toBe(true);
  });

  it("abortJob returns false for an unknown id", () => {
    const result = abortJob("00000000-0000-0000-0000-000000000000");
    expect(result).toBe(false);
  });

  it("clearJob removes the job without aborting", () => {
    const abort = new AbortController();
    const id = registerJob({ abort, storySlug: "story-2", chapterId: "ch-2" });
    clearJob(id);
    // Job is gone — abortJob returns false
    const result = abortJob(id);
    expect(result).toBe(false);
    // AbortController was NOT triggered
    expect(abort.signal.aborted).toBe(false);
  });
});
