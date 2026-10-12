import type { OrganizationType, PermissionKey, PermissionMeta } from "@/types";
import { availablePermissions, normalizePermissionKey } from "./catalog";

/**
 * Nobody can hand out access they do not hold themselves.
 *
 * Without this rule, one permission — "manage roles and permissions" — silently
 * becomes every permission, because its holder could simply write themselves a
 * role containing the rest. The grantable set is therefore the intersection of
 * what the organization type supports and what the granter personally has.
 *
 * An Owner holds everything, so for an Owner this is a no-op. It exists for
 * everyone else the Owner delegates to.
 */
export function grantablePermissions(
  granterPermissions: ReadonlySet<PermissionKey>,
  orgType: OrganizationType,
): PermissionMeta[] {
  return availablePermissions(orgType).filter((p) => granterPermissions.has(p.key));
}

export function grantablePermissionKeys(
  granterPermissions: ReadonlySet<PermissionKey>,
  orgType: OrganizationType,
): PermissionKey[] {
  return grantablePermissions(granterPermissions, orgType).map((p) => p.key);
}

export function canGrant(
  granterPermissions: ReadonlySet<PermissionKey | string>,
  key: PermissionKey | string,
): boolean {
  if (granterPermissions.has(key as any)) return true;
  const normalized = normalizePermissionKey(key);
  if (normalized && granterPermissions.has(normalized)) return true;
  return false;
}

/** The requested keys the granter has no right to hand out. */
export function ungrantablePermissions(
  requested: readonly (PermissionKey | string)[],
  granterPermissions: ReadonlySet<PermissionKey | string>,
): (PermissionKey | string)[] {
  return requested.filter((k) => !canGrant(granterPermissions, k));
}

/**
 * The last line of defence before anything is saved or sent: whatever the UI
 * believed, the result can never exceed the granter's own access.
 */
export function clampToGrantable(
  requested: readonly (PermissionKey | string)[],
  granterPermissions: ReadonlySet<PermissionKey>,
  orgType: OrganizationType,
): PermissionKey[] {
  const allowed = new Set(grantablePermissionKeys(granterPermissions, orgType));
  return requested.filter((k) => {
    if (allowed.has(k as PermissionKey)) return true;
    const normalized = normalizePermissionKey(k);
    if (normalized && allowed.has(normalized)) return true;
    return false;
  }) as PermissionKey[];
}

/* -------------------------------------------------------------------------- */
/* Role names                                                                  */
/* -------------------------------------------------------------------------- */

export const ROLE_NAME_MAX_LENGTH = 40;
export const ROLE_DESCRIPTION_MAX_LENGTH = 160;

/** Reserved because the app grants it structurally, not through a role. */
const RESERVED_ROLE_NAMES = new Set(["owner"]);

export function validateRoleName(
  raw: string,
  existingNames: readonly string[] = [],
): string | null {
  const value = raw.trim();
  if (!value) return "Give this role a name.";
  if (value.length < 2) return "That name is too short.";
  if (value.length > ROLE_NAME_MAX_LENGTH) {
    return `Use at most ${ROLE_NAME_MAX_LENGTH} characters.`;
  }
  if (RESERVED_ROLE_NAMES.has(value.toLowerCase())) {
    return "Owner is the permanent role and cannot be recreated.";
  }
  if (existingNames.some((n) => n.trim().toLowerCase() === value.toLowerCase())) {
    return "You already have a role with that name.";
  }
  return null;
}
