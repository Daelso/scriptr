import { notFound } from "next/navigation";
import { getBundle } from "@/lib/storage/bundles";
import { effectiveDataDir } from "@/lib/config";
import { BundleEditor } from "@/components/bundles/BundleEditor";

type Props = { params: Promise<{ slug: string }> };

export default async function BundleEditorPage({ params }: Props) {
  const { slug } = await params;
  const bundle = await getBundle(effectiveDataDir(), slug);
  if (!bundle) notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <BundleEditor initialBundle={bundle} />
    </main>
  );
}
