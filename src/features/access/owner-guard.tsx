"use client";

import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/data/states";
import { useActiveMembership } from "@/lib/session/hooks";

/**
 * Invitations, roles and permissions are the Owner's alone.
 *
 * Deciding who else gets in is the one thing that cannot be delegated by
 * accident, so this guards on the membership's ownership flag rather than on a
 * permission — a permission could itself be granted, which is exactly the loop
 * we are trying to avoid.
 */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const { membership, organization } = useActiveMembership();

  if (!membership?.isOwner) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Only the owner can manage access"
        description={`Inviting people and deciding what they can do is reserved for the owner of ${
          organization?.displayName ?? "this organization"
        }. Ask them to make the change for you.`}
      />
    );
  }
  return <>{children}</>;
}
