import { Suspense } from "react";
import { LoadingSkeleton } from "@/components/data/states";
import { AvailabilityBoardScreen } from "@/features/fleet/availability-board-screen";

export const metadata = { title: "Availability" };

// The screen reads `?bucket=` with useSearchParams, which needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <AvailabilityBoardScreen />
    </Suspense>
  );
}
