"use client";

import { ErrorState } from "@/components/data/states";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState onRetry={reset} />;
}
