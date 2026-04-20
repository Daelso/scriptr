import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { createStory } from "@/lib/storage/stories";
import { getStory } from "@/lib/storage/stories";
import type { Bible } from "@/lib/types";

describe("/api/stories/[slug]/bible", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-bible-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function callGet(slug: string) {
    const { GET } = await import("@/app/api/stories/[slug]/bible/route");
    const req = new Request(`http://localhost/api/stories/${slug}/bible`) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return GET(req, ctx);
  }

  async function callPut(slug: string, body: unknown) {
    const { PUT } = await import("@/app/api/stories/[slug]/bible/route");
    const req = new Request(`http://localhost/api/stories/${slug}/bible`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const ctx = { params: Promise.resolve({ slug }) };
    return PUT(req, ctx);
  }

  const validBible: Bible = {
    characters: [
      { name: "Alice", description: "Protagonist", traits: "brave" },
      { name: "Bob", description: "Antagonist" },
    ],
    setting: "A dystopian city",
    pov: "third-limited",
    tone: "dark",
    styleNotes: "Concise sentences",
    nsfwPreferences: "explicit",
  };

  // 1. GET on fresh story returns the default bible
  it("GET on fresh story returns the default bible", async () => {
    const story = await createStory(tmpDir, { title: "Fresh Story" });
    const res = await callGet(story.slug);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      characters: [],
      setting: "",
      pov: "third-limited",
      tone: "",
      styleNotes: "",
      nsfwPreferences: "",
    });
  });

  // 2. GET on nonexistent story returns 404
  it("GET on nonexistent story returns 404", async () => {
    const res = await callGet("does-not-exist");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("bible not found");
  });

  // 3. PUT persists a valid bible; subsequent GET returns saved content
  it("PUT persists a valid bible and subsequent GET returns it", async () => {
    const story = await createStory(tmpDir, { title: "Bible Story" });
    const res = await callPut(story.slug, validBible);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(validBible);

    // Subsequent GET returns saved content
    const getRes = await callGet(story.slug);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.data).toEqual(validBible);
  });

  // 4. PUT on nonexistent story returns 404
  it("PUT on nonexistent story returns 404", async () => {
    const res = await callPut("no-such-story", validBible);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("story not found");
  });

  // 5. PUT with wrong pov enum value → 400
  it("PUT with invalid pov enum value returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Pov Test" });
    const res = await callPut(story.slug, { ...validBible, pov: "omniscient" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid bible shape");
  });

  // 6. PUT with non-array characters → 400
  it("PUT with non-array characters returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Char Test" });
    const res = await callPut(story.slug, { ...validBible, characters: "not-an-array" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid bible shape");
  });

  // 7. PUT with character missing name or description → 400
  it("PUT with character missing name returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Name Test" });
    const res = await callPut(story.slug, {
      ...validBible,
      characters: [{ description: "No name here" }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid bible shape");
  });

  it("PUT with character missing description returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Desc Test" });
    const res = await callPut(story.slug, {
      ...validBible,
      characters: [{ name: "No description here" }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid bible shape");
  });

  // 8. PUT with non-string setting or tone → 400
  it("PUT with non-string setting returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Setting Test" });
    const res = await callPut(story.slug, { ...validBible, setting: 42 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid bible shape");
  });

  it("PUT with non-string tone returns 400", async () => {
    const story = await createStory(tmpDir, { title: "Tone Test" });
    const res = await callPut(story.slug, { ...validBible, tone: ["dark", "moody"] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid bible shape");
  });

  // 9. PUT bumps story.json's updatedAt
  it("PUT bumps story.json updatedAt", async () => {
    const story = await createStory(tmpDir, { title: "Timestamp Test" });
    const beforeUpdatedAt = story.updatedAt;

    // Small delay to ensure clock advances
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await callPut(story.slug, validBible);
    expect(res.status).toBe(200);

    const updated = await getStory(tmpDir, story.slug);
    expect(updated).not.toBeNull();
    expect(updated!.updatedAt > beforeUpdatedAt).toBe(true);
  });
});
