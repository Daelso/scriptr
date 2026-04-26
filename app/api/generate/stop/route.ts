import type { NextRequest } from "next/server";
import { ok, fail, readJson, JsonParseError } from "@/lib/api";
import { abortJob } from "@/lib/generation-job";

export async function POST(req: NextRequest) {
  let body: { jobId?: unknown };
  try {
    body = await readJson<{ jobId?: unknown }>(req);
  } catch (err) {
    if (err instanceof JsonParseError) return fail(err.message, 400);
    throw err;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("request body must be an object", 400);
  }

  if (typeof body.jobId !== "string" || body.jobId === "") {
    return fail("jobId required");
  }

  // stopped is true if the job was found and aborted, false if the jobId is unknown.
  // Returning stopped: true for a nonexistent job would be a lie — we report truthfully.
  const stopped = abortJob(body.jobId);
  return ok({ stopped });
}
