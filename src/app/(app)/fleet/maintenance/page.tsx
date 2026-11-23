import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { ServiceDueScreen } from "@/features/fleet/service-due-screen";

export const metadata = { title: "Service due" };

// The screen reads `?view=` with useSearchParams, which needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <ServiceDueScreen />
    </Suspense>
  );
}
