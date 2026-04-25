import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";

export type ResolvedAuthorNote = {
  messageHtml: string;
  email?: string;
  mailingListUrl?: string;
};

export function resolveAuthorNote(
  story: Story,
  profile: PenNameProfile | undefined,
): ResolvedAuthorNote | null {
  if (!profile) return null;
  if (story.authorNote?.enabled === false) return null;
  const overrideRaw = story.authorNote?.messageHtml ?? "";
  const override = overrideRaw.trim();
  const fallback = (profile.defaultMessageHtml ?? "").trim();
  const messageHtml = override.length > 0 ? override : fallback;
  if (messageHtml.length === 0 && !profile.email && !profile.mailingListUrl) {
    return null;
  }
  return {
    messageHtml,
    email: profile.email,
    mailingListUrl: profile.mailingListUrl,
  };
}
