import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { UsageScreen } from "@/features/usage/usage-screen";

export const metadata = { title: "Usage & costs" };

// The screen reads `?range=` with useSearchParams, which needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={3} />}>
      <UsageScreen />
    </Suspense>
  );
}
