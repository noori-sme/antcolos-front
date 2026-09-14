"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { PermissionBadge } from "@/components/auth/permission-badge";
import { Button } from "@/components/ui/button";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import type { PermissionKey } from "@/types";

/**
 * What a report looks like when the service says no.
 *
 * The denial comes from the service layer, so this screen reports a decision
 * rather than making one — and it names the permission, because "contact your
 * administrator" is not information.
 */
export function ReportDenied({
  required,
  message,
}: {
  required: PermissionKey[];
  message?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-st-warning-bg text-st-warning">
        <Lock aria-hidden className="size-5" />
      </div>
      <p className="text-[0.9375rem] font-semibold text-fg">
        This report is not available to your membership
      </p>
      <p className="mt-1 max-w-md text-[0.8125rem] text-fg-muted">
        {message ??
          "Reporting is decided by permissions, not by job title. An owner can grant what is missing."}
      </p>
      {required.length > 0 ? (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {required.map((key) => (
            <PermissionBadge key={key} permissionKey={key} />
          ))}
        </div>
      ) : null}
      <Button asChild variant="secondary" size="sm" className="mt-5">
        <Link href="/reports">Back to reports</Link>
      </Button>
    </div>
  );
}

/** Pulls the permission keys out of a service error, when it carries them. */
export function deniedPermissions(error: unknown): PermissionKey[] | null {
  if (error instanceof PermissionDeniedError) return error.required;
  return null;
}
