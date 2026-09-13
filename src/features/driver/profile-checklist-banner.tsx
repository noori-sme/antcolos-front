"use client";

import { ArrowRight, CircleCheck, FileText } from "lucide-react";
import Link from "next/link";
import { completion, documentRequirements } from "./mock-driver";
import { currentRelationship, useDriverData } from "./use-driver-data";
import { cn } from "@/lib/utils";

/**
 * "Complete your driver profile", on the driver's home screen.
 *
 * Prominent but never blocking: a driver with paperwork outstanding can still
 * see and run their loads. Withholding the job until the filing is done helps
 * nobody, so this nudges and gets out of the way.
 */
export function ProfileChecklistBanner() {
  const data = useDriverData();
  if (data.loading || !data.profile) return null;

  const relationship = currentRelationship(data.relationships.filter((r) => r.status !== "ended"));
  if (!relationship) return null;

  const progress = completion(
    documentRequirements(relationship.engagementType, relationship.carrierId),
    data.documents,
  );
  const done = progress.outstanding.length === 0;

  return (
    <Link
      href="/driver/documents"
      className={cn(
        "block rounded-lg border p-4 shadow-e1 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        done
          ? "border-st-success/35 bg-st-success-bg/40 hover:bg-st-success-bg/60"
          : "border-primary/40 bg-surface hover:bg-surface-hover",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            done ? "bg-st-success text-white" : "bg-primary text-primary-fg",
          )}
        >
          {done ? <CircleCheck className="size-[1.125rem]" /> : <FileText className="size-[1.125rem]" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-semibold text-fg">
            {done ? "Your driver profile is complete" : "Complete your driver profile"}
          </p>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            {done
              ? `${relationship.carrierName} has everything they asked for.`
              : `${progress.outstanding.length} ${progress.outstanding.length === 1 ? "document" : "documents"} still needed by ${relationship.carrierName}. You can keep driving while you sort them out.`}
          </p>
          {!done ? (
            <div
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Driver profile completion"
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
            </div>
          ) : null}
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
      </div>
    </Link>
  );
}
