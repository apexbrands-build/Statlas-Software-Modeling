import { Suspense } from "react";
import { Connections } from "@/components/Connections";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Suspense fallback={null}>
        <Connections />
      </Suspense>
      <SettingsForm />
    </div>
  );
}
