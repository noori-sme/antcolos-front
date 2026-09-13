"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { PermissionBadge } from "@/components/auth/permission-badge";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/lib/session/hooks";
import type { PermissionKey } from "@/types";

export function Forbidden({ required }: { required: PermissionKey[] }) {
  const { organization } = useActiveMembership();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-st-warning-bg text-st-warning">
        <ShieldAlert aria-hidden className="size-6" />
      </div>
      <h1 className="text-[1.25rem] font-semibold text-fg">
        You do not have access to this page
      </h1>
      <p className="mt-2 max-w-md text-[0.875rem] text-fg-muted">
        Your membership in {organization?.displayName ?? "this organization"} does
        not include the permission this page requires. An owner can grant it.
      </p>
      {required.length > 0 ? (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {required.map((key) => (
            <PermissionBadge key={key} permissionKey={key} />
          ))}
        </div>
      ) : null}
      <div className="mt-6 flex gap-2">
        <Button asChild variant="primary">
          <Link href="/home">Back to home</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/account/profile">Your account</Link>
        </Button>
      </div>
    </div>
  );
}
