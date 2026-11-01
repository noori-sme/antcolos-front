"use client";

import { ErrorState } from "@/components/data/states";

// `retry` re-fetches the segment before re-rendering; `reset` only re-renders.
export default function Error({ retry }: { error: Error; retry: () => void }) {
  return <ErrorState onRetry={retry} />;
}
