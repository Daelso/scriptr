import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/stories/route";
import type { Story } from "@/lib/types";

describe("/api/stories", () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scriptr-api-"));
    process.env = { ...originalEnv, SCRIPTR_DATA_DIR: tmpDir };
    delete process.env.XAI_API_KEY;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET returns empty array on fresh install", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("POST creates story, returns 201 with correct fields", async () => {
    const req = new Request("http://localhost/api/stories", {
      method: "POST",
      body: JSON.stringify({ title: "The Meeting", authorPenName: "Jane Doe" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const story: Story = body.data;
    expect(story.slug).toBe("the-meeting");
    expect(story.title).toBe("The Meeting");
    expect(story.authorPenName).toBe("Jane Doe");
  });

  it("POST then GET round-trip returns stories sorted by updatedAt desc", async () => {
    const req1 = new Request("http://localhost/api/stories", {
      method: "POST",
      body: JSON.stringify({ title: "First Story" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    await POST(req1);

    const req2 = new Request("http://localhost/api/stories", {
      method: "POST",
      body: JSON.stringify({ title: "Second Story" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    await POST(req2);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(2);
    // sorted by updatedAt desc — second story created later should come first
    expect(body.data[0].title).toBe("Second Story");
    expect(body.data[1].title).toBe("First Story");
  });

  it("POST with missing title returns 400", async () => {
    const emptyBody = new Request("http://localhost/api/stories", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const res1 = await POST(emptyBody);
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.ok).toBe(false);
    expect(body1.error).toBe("title required");

    const nullTitle = new Request("http://localhost/api/stories", {
      method: "POST",
      body: JSON.stringify({ title: null }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const res2 = await POST(nullTitle);
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.ok).toBe(false);
    expect(body2.error).toBe("title required");

    const nonStringTitle = new Request("http://localhost/api/stories", {
      method: "POST",
      body: JSON.stringify({ title: 42 }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;
    const res3 = await POST(nonStringTitle);
    expect(res3.status).toBe(400);
    const body3 = await res3.json();
    expect(body3.ok).toBe(false);
    expect(body3.error).toBe("title required");
  });

  it("POST with empty-string title returns 400", async () => {
    const req = new Request("http://localhost/api/stories", {
      method: "POST",
      body: JSON.stringify({ title: "" }),
      headers: { "content-type": "application/json" },
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("title required");
  });
});
