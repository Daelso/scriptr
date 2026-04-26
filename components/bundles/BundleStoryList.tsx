"use client";
import type { Bundle } from "@/lib/types";
type Props = { bundle: Bundle; onUpdate: () => void };
export function BundleStoryList(_props: Props) {
  return <div data-testid="bundle-story-list">story list (stub)</div>;
}
