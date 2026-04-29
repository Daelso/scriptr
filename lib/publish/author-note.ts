import QRCode from "qrcode";
import type { Story } from "@/lib/types";
import type { PenNameProfile } from "@/lib/config";
import { sanitizeWith } from "@/lib/publish/sanitize-server";
import {
  AUTHOR_NOTE_SANITIZE_OPTS,
  AUTHOR_NOTE_MESSAGE_SANITIZE_OPTS,
  type ResolvedAuthorNote,
} from "@/lib/publish/author-note-shared";

// Re-export so existing server-side imports (`@/lib/publish/author-note`)
// continue to work. Client components must import from
// `@/lib/publish/author-note-shared` directly to avoid pulling `qrcode`
// into client bundles.
export { AUTHOR_NOTE_SANITIZE_OPTS };
export { AUTHOR_NOTE_MESSAGE_SANITIZE_OPTS };
export type { ResolvedAuthorNote };

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;",
  '"': "&quot;", "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

const URI_CONTROL_OR_SPACE_RE = /[\u0000-\u001F\u007F\s]/u;
const URI_BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/u;

function sanitizeMessageHtml(html: string): string {
  return sanitizeWith(
    html,
    { ...AUTHOR_NOTE_MESSAGE_SANITIZE_OPTS },
    AUTHOR_NOTE_MESSAGE_SANITIZE_OPTS.ALLOWED_URI_REGEXP,
  );
}

function normalizeEmail(email?: string): string | undefined {
  if (typeof email !== "string") return undefined;
  const trimmed = email.trim();
  if (!trimmed) return undefined;
  if (URI_CONTROL_OR_SPACE_RE.test(trimmed)) return undefined;
  if (!trimmed.includes("@")) return undefined;
  return trimmed;
}

function normalizeMailingListUrl(url?: string): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (URI_CONTROL_OR_SPACE_RE.test(trimmed) || URI_BIDI_RE.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export async function buildAuthorNoteHtml(opts: {
  messageHtml: string;
  email?: string;
  mailingListUrl?: string;
}): Promise<string> {
  const { messageHtml, email, mailingListUrl } = opts;
  const safeMessageHtml = sanitizeMessageHtml(messageHtml);
  const safeEmail = normalizeEmail(email);
  const safeMailingListUrl = normalizeMailingListUrl(mailingListUrl);

  const parts: string[] = [];
  parts.push('<div class="author-note">');
  parts.push("<h2>A note from the author</h2>");
  parts.push('<div class="author-note-message">');
  parts.push(safeMessageHtml);
  parts.push("</div>");

  const footerParts: string[] = [];

  if (safeEmail) {
    const safe = escapeHtml(safeEmail);
    footerParts.push(`<p><a href="mailto:${safe}">${safe}</a></p>`);
  }

  if (safeMailingListUrl) {
    const safeUrl = escapeHtml(safeMailingListUrl);
    const dataUrl = await QRCode.toDataURL(safeMailingListUrl, {
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
  // Forward the full sanitize-opts object — including ALLOW_DATA_ATTR /
  // ALLOW_ARIA_ATTR — so the server-side build matches what the reader's
  // SafeHtml applies on the client. Spreading rather than cherry-picking
  // keeps the two paths in lockstep when new defense-in-depth flags are
  // added to AUTHOR_NOTE_SANITIZE_OPTS.
  return sanitizeWith(
    parts.join(""),
    { ...AUTHOR_NOTE_SANITIZE_OPTS },
    AUTHOR_NOTE_SANITIZE_OPTS.ALLOWED_URI_REGEXP,
  );
}

export function resolveBundleAuthorNote(
  profile: PenNameProfile | undefined,
): ResolvedAuthorNote | null {
  if (!profile) return null;
  const messageHtml =
    typeof profile.defaultMessageHtml === "string"
      ? profile.defaultMessageHtml.trim()
      : "";
  const email = typeof profile.email === "string" ? profile.email : undefined;
  const mailingListUrl =
    typeof profile.mailingListUrl === "string"
      ? profile.mailingListUrl
      : undefined;
  if (messageHtml.length === 0 && !email?.trim() && !mailingListUrl?.trim()) {
    return null;
  }
  return {
    messageHtml,
    email,
    mailingListUrl,
  };
}

export function resolveAuthorNote(
  story: Story,
  profile: PenNameProfile | undefined,
): ResolvedAuthorNote | null {
  if (!profile) return null;
  if (story.authorNote?.enabled === false) return null;
  const overrideRaw =
    typeof story.authorNote?.messageHtml === "string"
      ? story.authorNote.messageHtml
      : "";
  const override = overrideRaw.trim();
  const fallback =
    typeof profile.defaultMessageHtml === "string"
      ? profile.defaultMessageHtml.trim()
      : "";
  const messageHtml = override.length > 0 ? override : fallback;
  const email = typeof profile.email === "string" ? profile.email : undefined;
  const mailingListUrl =
    typeof profile.mailingListUrl === "string"
      ? profile.mailingListUrl
      : undefined;
  if (messageHtml.length === 0 && !email?.trim() && !mailingListUrl?.trim()) {
    return null;
  }
  return {
    messageHtml,
    email,
    mailingListUrl,
  };
}
