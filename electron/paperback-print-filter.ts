export function shouldAllowPaperbackPrintRequest(
  requestUrl: string,
  allowedFileUrl: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }

  if (parsed.href === allowedFileUrl) return true;

  // The generated paperback cover embeds the uploaded cover image as a data URL.
  if (parsed.protocol === "data:") return true;

  // Chromium may create an initial blank document before loadFile() navigates.
  if (parsed.href === "about:blank") return true;

  return false;
}
