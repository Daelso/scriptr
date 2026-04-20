"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { formatStyleRules, type StyleRules } from "@/lib/style";

export function StyleRulesPreview(props: { rules: Required<StyleRules> }) {
  const text = formatStyleRules(props.rules);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  if (text === "") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Preview</p>
        <p className="text-xs text-muted-foreground">
          This is the style block injected into every generation prompt.
        </p>
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="text-xs italic text-muted-foreground">
            No style rules — model will use its defaults.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">Preview</p>
      <p className="text-xs text-muted-foreground">
        This is the style block injected into every generation prompt.
      </p>
      <div className="relative">
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 pr-10 font-mono text-xs">
          {text}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy style rules"
          className="absolute right-2 top-2 flex items-center rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}
