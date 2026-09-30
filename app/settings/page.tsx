import { Suspense } from "react";
import { StoreSettingsPage } from "@/components/settings/StoreSettingsPage";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <StoreSettingsPage />
    </Suspense>
  );
}
