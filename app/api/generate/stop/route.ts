import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { abortJob } from "@/lib/generation-job";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { jobId?: unknown };

  if (typeof body.jobId !== "string" || body.jobId === "") {
    return fail("jobId required");
  }

  // stopped is true if the job was found and aborted, false if the jobId is unknown.
  // Returning stopped: true for a nonexistent job would be a lie — we report truthfully.
  const stopped = abortJob(body.jobId);
  return ok({ stopped });
}
