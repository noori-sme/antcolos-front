import type { Membership, PermissionKey } from "@/types";

/**
 * Nothing in Antcolos checks a role name. Ever. Everything reads `can()`.
 * Note the signature: it takes a permission set derived from a Membership —
 * there is no overload that accepts a User.
 */
export interface AccessContext {
  membership: Membership | null;
  permissions: ReadonlySet<PermissionKey>;
}

export function can(
  ctx: AccessContext | ReadonlySet<PermissionKey>,
  permission: PermissionKey,
): boolean {
  const set = ctx instanceof Set ? ctx : (ctx as AccessContext).permissions;
  return set.has(permission);
}

export function canAll(
  ctx: AccessContext | ReadonlySet<PermissionKey>,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.every((p) => can(ctx, p));
}

export function canAny(
  ctx: AccessContext | ReadonlySet<PermissionKey>,
  permissions: readonly PermissionKey[],
): boolean {
  if (permissions.length === 0) return true;
  return permissions.some((p) => can(ctx, p));
}
