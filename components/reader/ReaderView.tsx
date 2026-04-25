"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Story, Chapter } from "@/lib/types";
import { SafeHtml } from "@/lib/publish/safe-html";
import { AUTHOR_NOTE_SANITIZE_OPTS } from "@/lib/publish/author-note-shared";

interface ReaderViewProps {
  story: Story;
  chapters: Chapter[];
  authorNoteHtml?: string;
}

/**
 * Build the plain-text representation shared by "Copy all" and "Download .txt".
 *
 * Shape:
 *   Title
 *   by Author Pen Name
 *
 *   Chapter Title
 *
 *   Section content...
 *
 *   Section content...
 *
 *
 *   Next Chapter Title
 *   ...
 *
 *   © Year Author Pen Name
 */
function buildPlainText(story: Story, chapters: Chapter[]): string {
  const parts: string[] = [];

  parts.push(story.title);
  parts.push(`by ${story.authorPenName}`);
  parts.push("");

  if (chapters.length === 0) {
    parts.push("No chapters yet.");
  } else {
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      // Extra blank line between chapters (after the first).
      if (i > 0) {
        parts.push("");
        parts.push("");
      }
      parts.push(chapter.title);
      parts.push("");

      for (const section of chapter.sections) {
        parts.push(section.content);
        parts.push("");
      }
    }
  }

  parts.push("");
  parts.push(`\u00A9 ${story.copyrightYear} ${story.authorPenName}`);

  return parts.join("\n");
}

export function ReaderView({ story, chapters, authorNoteHtml }: ReaderViewProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText(story, chapters));
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleDownload = () => {
    const text = buildPlainText(story, chapters);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${story.slug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      {/* Controls */}
      <div className="mx-auto mb-8 flex flex-wrap gap-2" style={{ maxWidth: "68ch" }}>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          Copy all
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          Download .txt
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href={`/s/${story.slug}`} />}
        >
          Back to editor
        </Button>
      </div>

      {/* Reading column */}
      <article
        className="mx-auto"
        style={{
          maxWidth: "68ch",
          fontSize: "18px",
          lineHeight: "1.65",
          fontFamily:
            "Georgia, 'Times New Roman', Times, ui-serif, serif",
        }}
      >
        <header className="mb-10">
          <h1
            className="font-bold text-foreground"
            style={{ fontSize: "2rem", lineHeight: "1.2", marginBottom: "0.4rem" }}
          >
            {story.title}
          </h1>
          <p className="text-muted-foreground" style={{ fontSize: "1rem" }}>
            by {story.authorPenName}
          </p>
        </header>

        {chapters.length === 0 ? (
          <p className="text-muted-foreground italic">No chapters yet.</p>
        ) : (
          chapters.map((chapter) => (
            <section key={chapter.id} className="mb-16">
              <h2
                className="font-semibold text-foreground"
                style={{ fontSize: "1.25rem", lineHeight: "1.3", marginBottom: "1.5rem" }}
              >
                {chapter.title}
              </h2>
              {chapter.sections.map((section, sIdx) => (
                <div key={section.id} className={sIdx > 0 ? "mt-6" : undefined}>
                  {section.content
                    .split(/\n\s*\n/)
                    .filter((p) => p.trim().length > 0)
                    .map((para, pIdx) => (
                      <p
                        key={pIdx}
                        className="text-foreground"
                        style={{ margin: pIdx > 0 ? "1.1em 0 0" : "0" }}
                      >
                        {para.trim()}
                      </p>
                    ))}
                </div>
              ))}
            </section>
          ))
        )}

        {authorNoteHtml ? (
          <SafeHtml html={authorNoteHtml} extra={AUTHOR_NOTE_SANITIZE_OPTS} />
        ) : null}

        <footer className="mt-8 pt-6 border-t border-border">
          <p className="text-muted-foreground" style={{ fontSize: "0.9rem" }}>
            {"\u00A9"} {story.copyrightYear} {story.authorPenName}
          </p>
        </footer>
      </article>
    </div>
  );
}
