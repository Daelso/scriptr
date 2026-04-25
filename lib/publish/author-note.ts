import QRCode from "qrcode";
import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";
import { sanitizeWith } from "@/lib/publish/sanitize-html";
import {
  AUTHOR_NOTE_SANITIZE_OPTS,
  type ResolvedAuthorNote,
} from "@/lib/publish/author-note-shared";

// Re-export so existing server-side imports (`@/lib/publish/author-note`)
// continue to work. Client components must import from
// `@/lib/publish/author-note-shared` directly to avoid pulling `qrcode`
// into client bundles.
export { AUTHOR_NOTE_SANITIZE_OPTS };
export type { ResolvedAuthorNote };

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;",
  '"': "&quot;", "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export async function buildAuthorNoteHtml(opts: {
  messageHtml: string;
  email?: string;
  mailingListUrl?: string;
}): Promise<string> {
  const { messageHtml, email, mailingListUrl } = opts;

  const parts: string[] = [];
  parts.push('<div class="author-note">');
  parts.push("<h2>A note from the author</h2>");
  parts.push('<div class="author-note-message">');
  parts.push(messageHtml);
  parts.push("</div>");

  const footerParts: string[] = [];

  if (email && email.trim().length > 0) {
    const safe = escapeHtml(email.trim());
    footerParts.push(`<p><a href="mailto:${safe}">${safe}</a></p>`);
  }

  if (mailingListUrl && mailingListUrl.trim().length > 0) {
    const url = mailingListUrl.trim();
    const safeUrl = escapeHtml(url);
    const dataUrl = await QRCode.toDataURL(url, {
      type: "image/png",
      width: 200,
      margin: 1,
    });
    footerParts.push("<p>Join the mailing list:</p>");
    footerParts.push(`<p><a href="${safeUrl}">${safeUrl}</a></p>`);
    footerParts.push(
      `<img src="${dataUrl}" alt="QR code linking to the mailing list" width="200" height="200" />`,
    );
  }

  if (footerParts.length > 0) {
    parts.push('<div class="author-note-footer">');
    parts.push(...footerParts);
    parts.push("</div>");
  }

  parts.push("</div>");

  // CRITICAL: sanitize the assembled tree so both consumers (EPUB and
  // reader) receive already-safe HTML. The reader's SafeHtml will sanitize
  // again on the client (defense in depth, idempotent); the EPUB build
  // path has no sanitizer of its own.
  return sanitizeWith(
    parts.join(""),
    {
      ALLOWED_TAGS: AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_TAGS,
      ALLOWED_ATTR: AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_ATTR,
      ALLOWED_URI_REGEXP: AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP,
    },
    AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP,
  );
}

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
