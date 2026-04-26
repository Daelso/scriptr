"use client";

import useSWR from "swr";
import type { Bundle } from "@/lib/types";
import { BundleMetadataPane } from "@/components/bundles/BundleMetadataPane";
import { BundleStoryList } from "@/components/bundles/BundleStoryList";
import { BundlePreviewPane } from "@/components/bundles/BundlePreviewPane";

const fetcher = async (url: string): Promise<Bundle> => {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "request failed");
  return json.data as Bundle;
};

type Props = { initialBundle: Bundle };

export function BundleEditor({ initialBundle }: Props) {
  const { data, mutate } = useSWR<Bundle>(
    `/api/bundles/${initialBundle.slug}`,
    fetcher,
    { fallbackData: initialBundle, revalidateOnFocus: false },
  );
  const bundle = data ?? initialBundle;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-8">
      <div className="flex flex-col gap-6">
        <BundleMetadataPane bundle={bundle} onUpdate={() => void mutate()} />
        <BundleStoryList bundle={bundle} onUpdate={() => void mutate()} />
      </div>
      <div className="md:sticky md:top-16 md:self-start">
        <BundlePreviewPane slug={bundle.slug} bundle={bundle} />
      </div>
    </div>
  );
}
