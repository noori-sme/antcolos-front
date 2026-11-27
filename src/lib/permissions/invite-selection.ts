import type { PermissionKey } from "@/types";
import { ungrantablePermissions } from "./grantable";

/**
 * The invite flow's "did the person change the ticks?" decision.
 *
 * Compares against what choosing the preset actually ticked, not the preset's own list:
 * a non-owner's screen drops keys they cannot grant (and a preset can carry a key the
 * catalog no longer has), so the two differ although nobody touched anything. Comparing
 * to the preset's list made every such invitation a "<Preset> (Custom)" role.
 */
export function selectionChanged(initial: ReadonlySet<string>, current: ReadonlySet<string>): boolean {
  if (initial.size !== current.size) return true;
  for (const key of current) if (!initial.has(key)) return true;
  return false;
}

/**
 * Whether an untouched preset can be sent as the built-in role with no permission list, so
 * the backend applies that role's own template (invitations-api-contract: "Omit it to apply
 * the role template only"). The backend refuses (403) when the inviter does not hold every
 * permission the invitee would receive, so a non-owner must hold the whole template; when the
 * template is unknown, the caller keeps sending its list instead.
 */
export function canSendBuiltInTemplate(input: {
  isOwner: boolean;
  template: readonly string[] | undefined;
  granter: ReadonlySet<string>;
}): boolean {
  if (input.isOwner) return true;
  if (!input.template) return false;
  return ungrantablePermissions(input.template, input.granter).length === 0;
}

/**
 * The roles someone may move a member to (plan 29): every role for an owner; otherwise only
 * roles whose permissions they hold in full, as the backend checks (invariant 5).
 */
export function assignableRoles<R extends { permissions: readonly string[] }>(
  roles: readonly R[],
  granter: ReadonlySet<PermissionKey | string>,
  isOwner: boolean,
): R[] {
  if (isOwner) return [...roles];
  return roles.filter((role) => ungrantablePermissions(role.permissions, granter).length === 0);
}
