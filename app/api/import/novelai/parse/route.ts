import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api";
import { decodeNovelAIStory, NovelAIDecodeError } from "@/lib/novelai/decode";
import { splitProse } from "@/lib/novelai/split";
import { mapToProposedWrite } from "@/lib/novelai/map";

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("No file uploaded.", 400);
  }

  const fileEntry = form.get("file");
  if (
    fileEntry === null ||
    typeof fileEntry !== "object" ||
    typeof (fileEntry as { arrayBuffer?: unknown }).arrayBuffer !== "function"
  ) {
    return fail("No file uploaded.", 400);
  }
  const fileLike = fileEntry as { arrayBuffer(): Promise<ArrayBuffer> };

  const buf = Buffer.from(await fileLike.arrayBuffer());
  if (buf.byteLength === 0) {
    return fail("No file uploaded.", 400);
  }

  let parsed;
  try {
    parsed = await decodeNovelAIStory(buf);
  } catch (err) {
    if (err instanceof NovelAIDecodeError) return fail(err.userMessage, 400);
    return fail("Could not read the document inside this .story file.", 400);
  }

  const split = splitProse(parsed.prose);
  const proposed = mapToProposedWrite(parsed);

  return ok({ parsed, split, proposed });
}
