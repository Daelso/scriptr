"use client";

import { formatStyleRules, type StyleRules } from "@/lib/style";

export function StyleRulesPreview(props: { rules: Required<StyleRules> }) {
  const text = formatStyleRules(props.rules);

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
      <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}
