import type { Membership, PermissionKey } from "@/types";
import { normalizePermissionKey, migrateKey } from "./catalog";

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
  permission: PermissionKey | string,
): boolean {
  const set = ctx instanceof Set ? ctx : (ctx as AccessContext)?.permissions;
  if (!set || set.size === 0) return false;
  if (set.has(permission as PermissionKey)) return true;

  // Try normalized key
  const normalized = normalizePermissionKey(permission);
  if (normalized && set.has(normalized)) return true;

  // Try backend dot-notation / migrated key
  const migrated = migrateKey(permission) as PermissionKey;
  if (migrated && set.has(migrated)) return true;

  // Check if dot version exists
  if (typeof permission === "string") {
    if (permission.includes(":")) {
      const dot = permission.replace(/:/g, ".") as PermissionKey;
      if (set.has(dot)) return true;
    } else if (permission.includes(".")) {
      const colon = permission.replace(/\./g, ":") as PermissionKey;
      if (set.has(colon)) return true;
    }
  }

  return false;
}

export function canAll(
  ctx: AccessContext | ReadonlySet<PermissionKey>,
  permissions: readonly (PermissionKey | string)[],
): boolean {
  return permissions.every((p) => can(ctx, p as PermissionKey));
}

export function canAny(
  ctx: AccessContext | ReadonlySet<PermissionKey>,
  permissions: readonly (PermissionKey | string)[],
): boolean {
  if (permissions.length === 0) return true;
  return permissions.some((p) => can(ctx, p as PermissionKey));
}
