import { SettingsForm } from "@/components/settings/SettingsForm";
import { PrivacyPanel } from "@/components/settings/PrivacyPanel";
import { Separator } from "@/components/ui/separator";

export const metadata = {
  title: "Settings — scriptr",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[600px] px-6 py-12">
      <h1 className="mb-8 text-xl font-semibold tracking-tight">Settings</h1>
      <SettingsForm />
      <div className="my-10">
        <Separator />
      </div>
      <PrivacyPanel />
    </div>
  );
}
