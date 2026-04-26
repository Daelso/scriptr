"use client";
import type { Bundle } from "@/lib/types";
type Props = { bundle: Bundle; onUpdate: () => void };
export function BundleMetadataPane(_props: Props) {
  return <div data-testid="bundle-metadata-pane">metadata pane (stub)</div>;
}
