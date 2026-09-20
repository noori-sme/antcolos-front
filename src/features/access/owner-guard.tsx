"use client";

import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/data/states";
import { permissionMeta } from "@/lib/permissions";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";
import type { PermissionKey } from "@/types";

/**
 * The guards in front of the access screens.
 *
 * ███ THESE ARE USER EXPERIENCE, NOT SECURITY ███
 * Hiding a screen prevents confusion, not attack. Every one of these checks
 * runs in a browser against a permission set the browser assembled, and the
 * matching service call re-checks the same thing on its own — which is the
 * check that a server has to be the one performing. A guard that were the only
 * check would be a guard somebody removes with dev tools.
 */

/**
 * Reserved for the things that belong to the permanent Owner alone.
 *
 * Guards on the ownership FLAG rather than on a permission, because a
 * permission could itself be granted — and for a power that decides who else
 * may decide, that is the loop worth avoiding.
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

/**
 * Requires one permission, which an Owner always satisfies.
 *
 * ★ WHY THIS IS NOT `OwnerOnly` WITH AN EXTRA CLAUSE ★
 * An active owner holds every permission their organization type supports —
 * `effectivePermissions` returns the whole available set for one — so "the
 * owner, or anybody they have given this to" is exactly one check, and writing
 * it as `isOwner || can(...)` would suggest the two can disagree. They cannot.
 * Nothing here branches on a role name, and there is no second structural flag
 * beside `isOwner`: delegation is a permission, which is the only mechanism the
 * product has for it.
 */
export function RequiresPermission({
  permission,
  title,
  children,
}: {
  permission: PermissionKey;
  /** Overrides the generated heading when the feature has a better name for itself. */
  title?: string;
  children: ReactNode;
}) {
  const permissions = usePermissions();
  const { organization } = useActiveMembership();

  if (!permissions.has(permission)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={title ?? `You do not have permission to do this`}
        description={
          `“${permissionMeta(permission).label}” is needed for this, and it has not been given `
          + `to you in ${organization?.displayName ?? "this organization"}. `
          + "The owner can grant it, or make the change for you."
        }
      />
    );
  }
  return <>{children}</>;
}
