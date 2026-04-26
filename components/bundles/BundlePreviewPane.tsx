"use client";
import type { Bundle } from "@/lib/types";
type Props = { slug: string; bundle: Bundle };
export function BundlePreviewPane(_props: Props) {
  return <div data-testid="bundle-preview-pane">preview pane (stub)</div>;
}
