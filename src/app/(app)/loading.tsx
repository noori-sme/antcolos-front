import { LoadingSkeleton } from "@/components/data/states";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-section">
      <Skeleton className="h-8 w-56" />
      <LoadingSkeleton rows={6} />
    </div>
  );
}
