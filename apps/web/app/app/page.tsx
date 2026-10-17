import { Suspense } from "react";
import type { Metadata } from "next";
import { Dashboard } from "@/components/app/dashboard";

export const metadata: Metadata = { title: "PinePoint app" };

export default function AppPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading.</p>}>
      <Dashboard />
    </Suspense>
  );
}
