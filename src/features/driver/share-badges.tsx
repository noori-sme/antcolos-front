"use client";

import type { DocumentSharePackage, SharePackageState } from "@/types";
import { SHARE_STATE_LABEL } from "@/types";
import { shareState } from "@/lib/api/mock/document-shares";
import { cn } from "@/lib/utils";

const TONE: Record<SharePackageState, string> = {
  issued: "bg-st-info-bg text-st-info",
  delivery_pending: "bg-st-progress-bg text-st-progress",
  delivered: "bg-st-progress-bg text-st-progress",
  opened: "bg-st-success-bg text-st-success",
  expired: "bg-st-neutral-bg text-st-neutral",
  revoked: "bg-st-neutral-bg text-st-neutral",
  failed: "bg-st-danger-bg text-st-danger",
};

/** What a share is doing right now, derived on read rather than stored stale. */
export function ShareStateChip({ pkg, className }: { pkg: DocumentSharePackage; className?: string }) {
  const state = shareState(pkg);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
        TONE[state],
        className,
      )}
    >
      {SHARE_STATE_LABEL[state]}
    </span>
  );
}
